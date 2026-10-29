"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toDateKey } from "@/lib/time";
import { proposeStepsViaApi } from "../ai/break-steps";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { aiDecision, aiProposal, GOAL_CATEGORIES, MEASURES, step, STEP_STATUSES } from "../db/schema";
import { env } from "../env";
import { createStepsInNotion, saveGoalInNotion, updateStepInNotion } from "../integrations/notion/sync";
import { syncFeed } from "../sync/run";
import type { ActionState } from "./integrations";

// Your own edits save straight to Notion (the source of truth), then the mirror re-syncs.

const refresh = () => {
  for (const p of ["/goals", "/today", "/week", "/month"]) revalidatePath(p);
};
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");
const optional = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

const goalSchema = z.object({
  title: z.string().trim().min(1, "Give the goal a title").max(200),
  category: z.enum(GOAL_CATEGORIES),
  priority: z.enum(["main", "secondary"]),
  why: z.string().max(2000).nullable(),
  targetDate: z.iso.date().nullable(),
  measure: z.enum(MEASURES),
  status: z.enum(["active", "paused", "done", "dropped"]),
});

export async function saveGoalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = goalSchema.safeParse({
    title: form.get("title"),
    category: form.get("category"),
    priority: form.get("priority"),
    why: optional(form.get("why")),
    targetDate: optional(form.get("targetDate")),
    measure: form.get("measure"),
    status: form.get("status") ?? "active",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    await saveGoalInNotion(optional(form.get("id")), parsed.data);
    await syncFeed("notion", "manual");
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  refresh();
  return { ok: true, message: "Saved to Notion" };
}

async function nextOrder(goalId: string) {
  const [row] = await db().select({ n: max(step.order) }).from(step).where(eq(step.goalId, goalId));
  return (row?.n ?? 0) + 1;
}

export async function addStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = z
    .object({
      goalId: z.string().min(1),
      title: z.string().trim().min(1, "Give the step a title").max(200),
      estimateMin: z.coerce.number().int().min(5).max(480).nullable(),
      due: z.iso.date().nullable(),
    })
    .safeParse({
      goalId: form.get("goalId"),
      title: form.get("title"),
      estimateMin: optional(form.get("estimateMin")),
      due: optional(form.get("due")),
    });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { goalId, ...s } = parsed.data;
  try {
    await createStepsInNotion(goalId, [{ ...s, status: "todo" }], await nextOrder(goalId));
    await syncFeed("notion", "manual");
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  refresh();
  return { ok: true, message: "Step added" };
}

export async function setStepStatusAction(stepId: string, status: (typeof STEP_STATUSES)[number]): Promise<ActionState> {
  await requireUser();
  if (!STEP_STATUSES.includes(status)) return { ok: false, message: "Unknown status" };
  const s = await db().query.step.findFirst({ where: eq(step.id, stepId) });
  if (!s) return { ok: false, message: "Step not found" };
  const doneOn = status === "done" ? toDateKey(new Date(), env().APP_TIMEZONE) : null;
  try {
    await updateStepInNotion(stepId, { title: s.title, estimateMin: s.estimateMin, due: s.due, status, doneOn });
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  await db().update(step).set({ status, doneOn }).where(eq(step.id, stepId));
  refresh();
  return { ok: true, message: "Saved" };
}

/** Claude API path. With Claude Desktop, the same proposal arrives through the MCP tool. */
export async function breakIntoStepsAction(goalId: string): Promise<ActionState> {
  await requireUser();
  try {
    await proposeStepsViaApi(goalId);
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  refresh();
  return { ok: true, message: "Steps proposed. Pick the ones to add." };
}

const applySchema = z.array(z.object({ title: z.string().trim().min(1).max(200), estimate_min: z.number().int().min(5).max(480) }));

/** Adds the steps you ticked (possibly edited) to Notion. The rest are logged as skipped. */
export async function applyStepsProposalAction(proposalId: number, chosen: z.infer<typeof applySchema>): Promise<ActionState> {
  await requireUser();
  const p = await db().query.aiProposal.findFirst({ where: and(eq(aiProposal.id, proposalId), eq(aiProposal.status, "pending")) });
  if (!p) return { ok: false, message: "This proposal is no longer open." };
  const parsed = applySchema.safeParse(chosen);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, message: "Tick at least one step." };
  try {
    await createStepsInNotion(
      p.targetId,
      parsed.data.map((s) => ({ title: s.title, estimateMin: s.estimate_min, due: null, status: "todo" as const })),
      await nextOrder(p.targetId),
    );
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  const proposed = (p.payload as { steps: { title: string; estimate_min: number }[] }).steps;
  await db().update(aiProposal).set({ status: "applied" }).where(eq(aiProposal.id, proposalId));
  await db().insert(aiDecision).values({
    aiRunId: p.aiRunId,
    item: `proposal:${proposalId}`,
    decision: parsed.data.length === proposed.length ? "approved" : "edited",
    before: { steps: proposed },
    after: { steps: parsed.data },
  });
  await syncFeed("notion", "manual");
  refresh();
  return { ok: true, message: `Added ${parsed.data.length} step(s) to Notion` };
}

export async function dismissProposalAction(proposalId: number): Promise<ActionState> {
  await requireUser();
  const p = await db().query.aiProposal.findFirst({ where: eq(aiProposal.id, proposalId) });
  if (!p) return { ok: false, message: "Not found" };
  await db().update(aiProposal).set({ status: "dismissed" }).where(eq(aiProposal.id, proposalId));
  await db().insert(aiDecision).values({ aiRunId: p.aiRunId, item: `proposal:${proposalId}`, decision: "skipped", before: p.payload as object });
  refresh();
  return { ok: true, message: "Dismissed" };
}
