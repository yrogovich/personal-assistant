"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { draftReviewViaApi, reviewPeriod, type ReviewType } from "../ai/review";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { aiDecision, review } from "../db/schema";
import { createReviewInNotion } from "../integrations/notion/sync";
import type { ActionState } from "./integrations";

const TYPES = ["daily", "weekly"] as const;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

export async function draftReviewAction(type: ReviewType, notes: string): Promise<ActionState> {
  await requireUser();
  if (!TYPES.includes(type)) return { ok: false, message: "Unknown review type" };
  try {
    await draftReviewViaApi(type, notes.trim().slice(0, 2000) || null);
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  revalidatePath("/review");
  return { ok: true, message: "Draft ready. Edit it, then confirm." };
}

const fmt = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/** The only path to Notion: you confirm the (edited) text. */
export async function confirmReviewAction(type: ReviewType, text: string): Promise<ActionState> {
  await requireUser();
  if (!TYPES.includes(type)) return { ok: false, message: "Unknown review type" };
  const final = text.trim();
  if (!final) return { ok: false, message: "Write something first." };
  const period = reviewPeriod(type, new Date());
  let row = await db().query.review.findFirst({ where: and(eq(review.type, type), eq(review.periodStart, period.start)) });
  if (row?.status === "confirmed") return { ok: false, message: "Already saved to Notion." };
  if (!row) {
    [row] = await db()
      .insert(review)
      .values({ type, periodStart: period.start, periodEnd: period.end, source: "manual" })
      .returning();
  }
  const title =
    type === "daily" ? `Check-in ${fmt(period.start)}` : `Weekly review ${fmt(period.start)} – ${fmt(period.end)}`;
  let notionPageId: string;
  try {
    notionPageId = await createReviewInNotion({ title, type, periodStart: period.start, periodEnd: period.end, markdown: final });
  } catch (err) {
    return { ok: false, message: `Not saved to Notion: ${errorMessage(err)}` };
  }
  await db()
    .update(review)
    .set({ final, status: "confirmed", notionPageId, confirmedAt: new Date() })
    .where(eq(review.id, row.id));
  if (row.draft) {
    await db().insert(aiDecision).values({
      aiRunId: row.aiRunId,
      item: `review:${row.id}`,
      decision: row.draft.trim() === final ? "approved" : "edited",
      before: { text: row.draft },
      after: row.draft.trim() === final ? null : { text: final },
    });
  }
  revalidatePath("/review");
  return { ok: true, message: "Saved to Notion" };
}
