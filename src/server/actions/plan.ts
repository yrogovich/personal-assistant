"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { atTime, toDateKey } from "@/lib/time";
import { generateOnce, hasPlanFor } from "../ai/morning-plan";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { aiDecision, dayPlan, proposedBlock, step } from "../db/schema";
import { env } from "../env";
import { deletePlanEvent, insertPlanEvent } from "../integrations/google/plan-calendar";
import { markStepDoneInNotion } from "../integrations/notion/sync";
import { setSetting } from "../settings";
import { syncFeed } from "../sync/run";
import type { ActionState } from "./integrations";

const refresh = () => {
  revalidatePath("/today");
  revalidatePath("/week");
};
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

async function generate(trigger: "first_open" | "replan"): Promise<ActionState> {
  try {
    const { dropped } = await generateOnce(trigger);
    refresh();
    return { ok: true, message: dropped ? `Plan ready (${dropped} block(s) didn't fit your free time and were dropped)` : "Plan ready" };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/** Called by the Today page on the first open of the day if the 06:30 run didn't happen. */
export async function ensureTodayPlanAction(): Promise<ActionState> {
  await requireUser();
  if (await hasPlanFor(toDateKey(new Date(), env().APP_TIMEZONE))) return { ok: true, message: "Plan ready" };
  return generate("first_open");
}

export async function replanAction(): Promise<ActionState> {
  await requireUser();
  return generate("replan");
}

async function loadBlock(id: number) {
  const block = await db().query.proposedBlock.findFirst({ where: eq(proposedBlock.id, id) });
  const plan = block ? await db().query.dayPlan.findFirst({ where: eq(dayPlan.id, block.dayPlanId) }) : undefined;
  return { block, plan };
}

const editSchema = z.object({
  title: z.string().trim().min(1).max(120),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

/**
 * The only path from an AI suggestion to your calendar: you press Approve (optionally after editing).
 * Writes one event to the "Plan" calendar in Google.
 */
export async function approveBlockAction(id: number, edit?: z.infer<typeof editSchema>): Promise<ActionState> {
  await requireUser();
  const { block, plan } = await loadBlock(id);
  if (!block || !plan || block.status !== "proposed") return { ok: false, message: "This block is no longer open." };

  let { title, startAt, endAt } = block;
  if (edit) {
    const parsed = editSchema.safeParse(edit);
    if (!parsed.success) return { ok: false, message: "Check the title and times." };
    const tz = env().APP_TIMEZONE;
    const day = atTime(new Date(), "12:00", tz);
    title = parsed.data.title;
    startAt = atTime(day, parsed.data.start, tz);
    endAt = atTime(day, parsed.data.end, tz);
    if (endAt <= startAt) return { ok: false, message: "End must be after start." };
  }
  const edited = edit && (title !== block.title || startAt.getTime() !== block.startAt.getTime() || endAt.getTime() !== block.endAt.getTime());

  let googleEventId: string;
  try {
    googleEventId = await insertPlanEvent({ id, title, reason: block.reason, start: startAt, end: endAt });
  } catch (err) {
    return { ok: false, message: `Not added to Google Calendar: ${errorMessage(err)}` };
  }
  await db()
    .update(proposedBlock)
    .set({ status: "approved", title, startAt, endAt, googleEventId, decidedAt: new Date() })
    .where(eq(proposedBlock.id, id));
  await db().insert(aiDecision).values({
    aiRunId: plan.aiRunId,
    item: `block:${id}`,
    decision: edited ? "edited" : "approved",
    before: { title: block.title, start: block.startAt, end: block.endAt },
    after: edited ? { title, start: startAt, end: endAt } : null,
  });
  await syncFeed("google_calendar", "manual");
  refresh();
  return { ok: true, message: "Added to your Plan calendar" };
}

export async function skipBlockAction(id: number): Promise<ActionState> {
  await requireUser();
  const { block, plan } = await loadBlock(id);
  if (!block || !plan || block.status !== "proposed") return { ok: false, message: "This block is no longer open." };
  await db().update(proposedBlock).set({ status: "skipped", decidedAt: new Date() }).where(eq(proposedBlock.id, id));
  await db().insert(aiDecision).values({
    aiRunId: plan.aiRunId,
    item: `block:${id}`,
    decision: "skipped",
    before: { title: block.title, start: block.startAt, end: block.endAt },
  });
  refresh();
  return { ok: true, message: "Skipped" };
}

/** Takes an approved block back off the Plan calendar. */
export async function removeBlockAction(id: number): Promise<ActionState> {
  await requireUser();
  const { block, plan } = await loadBlock(id);
  if (!block || !plan || block.status !== "approved") return { ok: false, message: "Only approved blocks can be removed." };
  try {
    if (block.googleEventId) await deletePlanEvent(block.googleEventId);
  } catch (err) {
    return { ok: false, message: `Couldn't remove it from Google Calendar: ${errorMessage(err)}` };
  }
  await db().update(proposedBlock).set({ status: "skipped", decidedAt: new Date() }).where(eq(proposedBlock.id, id));
  await db().insert(aiDecision).values({
    aiRunId: plan.aiRunId,
    item: `block:${id}`,
    decision: "removed",
    before: { title: block.title, start: block.startAt, end: block.endAt },
  });
  await syncFeed("google_calendar", "manual");
  refresh();
  return { ok: true, message: "Removed from your Plan calendar" };
}

/** Your own edit: saves straight to Notion. */
export async function markStepDoneAction(stepId: string): Promise<ActionState> {
  await requireUser();
  const s = await db().query.step.findFirst({ where: eq(step.id, stepId) });
  if (!s) return { ok: false, message: "Step not found" };
  const today = toDateKey(new Date(), env().APP_TIMEZONE);
  try {
    await markStepDoneInNotion(stepId, today);
  } catch (err) {
    return { ok: false, message: `Notion wasn't updated: ${errorMessage(err)}` };
  }
  await db().update(step).set({ status: "done", doneOn: today }).where(eq(step.id, stepId));
  refresh();
  return { ok: true, message: "Done" };
}

const windowSchema = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });

/** "I have free time at work today": lets the planner put learning steps in that window. */
export async function setFreeAtWorkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  if (form.get("clear")) {
    await setSetting("freeAtWork", null);
    refresh();
    return { ok: true, message: "Cleared" };
  }
  const parsed = windowSchema.safeParse({ start: form.get("start"), end: form.get("end") });
  if (!parsed.success || parsed.data.end <= parsed.data.start) return { ok: false, message: "Pick a start and end time." };
  await setSetting("freeAtWork", { date: toDateKey(new Date(), env().APP_TIMEZONE), ...parsed.data });
  refresh();
  return { ok: true, message: "Saved. Press Replan to use it." };
}
