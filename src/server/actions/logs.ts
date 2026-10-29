"use server";

import { addDays } from "date-fns";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toDateKey } from "@/lib/time";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { book, habitConfirmation, readingLog, reelLog, weightLog } from "../db/schema";
import { env } from "../env";
import { createBookInNotion, updateBookProgressInNotion } from "../integrations/notion/sync";
import { syncFeed } from "../sync/run";
import type { ActionState } from "./integrations";

// Your own logs save directly (no approval step): they're your edits, not AI suggestions.

const refresh = () => {
  revalidatePath("/today");
  revalidatePath("/week");
};
const today = () => toDateKey(new Date(), env().APP_TIMEZONE);
const fail = (message: string): ActionState => ({ ok: false, message });

export async function logReadingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = z
    .object({ bookId: z.string().min(1), page: z.coerce.number().int().min(0) })
    .safeParse({ bookId: form.get("bookId"), page: form.get("page") });
  if (!parsed.success) return fail("Enter the page you reached.");
  const { bookId, page } = parsed.data;
  const b = await db().query.book.findFirst({ where: eq(book.id, bookId) });
  if (!b) return fail("Book not found. Sync Notion and try again.");
  if (b.totalPages && page > b.totalPages) return fail(`This book has ${b.totalPages} pages.`);

  const date = today();
  const hasLogs = await db().query.readingLog.findFirst({ where: eq(readingLog.bookId, bookId) });
  if (!hasLogs && (b.currentPage ?? 0) > 0) {
    // First log for a book that already had progress in Notion: record that as yesterday's baseline,
    // so this week's pages count only what was read since.
    await db()
      .insert(readingLog)
      .values({ bookId, page: b.currentPage!, date: toDateKey(addDays(new Date(), -1), env().APP_TIMEZONE) });
  }
  await db().insert(readingLog).values({ bookId, page, date });

  const finishedOn = b.totalPages && page >= b.totalPages ? date : null;
  await db()
    .update(book)
    .set({ currentPage: page, ...(finishedOn ? { status: "finished" as const, finishedOn } : {}) })
    .where(eq(book.id, bookId));
  try {
    await updateBookProgressInNotion(bookId, { currentPage: page, finishedOn });
  } catch (err) {
    refresh();
    return fail(`Saved here, but Notion wasn't updated: ${err instanceof Error ? err.message : "error"}`);
  }
  refresh();
  return { ok: true, message: finishedOn ? `Finished “${b.title}”` : `Page ${page} saved` };
}

export async function addBookAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = z
    .object({ title: z.string().trim().min(1), totalPages: z.coerce.number().int().positive() })
    .safeParse({ title: form.get("title"), totalPages: form.get("totalPages") });
  if (!parsed.success) return fail("Enter a title and the total number of pages.");
  try {
    await createBookInNotion({ ...parsed.data, startedOn: today() });
    await syncFeed("notion", "manual");
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not add the book");
  }
  refresh();
  return { ok: true, message: "Book added" };
}

export async function logReelAction(): Promise<ActionState> {
  await requireUser();
  await db().insert(reelLog).values({ date: today() });
  refresh();
  return { ok: true, message: "Reel logged" };
}

export async function undoLastReelAction(): Promise<ActionState> {
  await requireUser();
  const last = await db().query.reelLog.findFirst({ where: eq(reelLog.date, today()), orderBy: desc(reelLog.id) });
  if (last) await db().delete(reelLog).where(eq(reelLog.id, last.id));
  refresh();
  return { ok: true, message: last ? "Removed today's last reel" : "No reel logged today" };
}

export async function logWeightAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = z.coerce
    .number()
    .min(30)
    .max(250)
    .safeParse(String(form.get("kg") ?? "").replace(",", "."));
  if (!parsed.success) return fail("Enter your weight in kg, e.g. 74.6");
  const date = today();
  await db()
    .insert(weightLog)
    .values({ date, kg: parsed.data, source: "manual" })
    .onConflictDoUpdate({ target: [weightLog.date, weightLog.source], set: { kg: parsed.data } });
  revalidatePath("/today");
  revalidatePath("/week");
  return { ok: true, message: `${parsed.data} kg saved` };
}

/** Confirms a planned run/gym session that Strava/Hevy didn't record (or an unplanned gym visit today). */
export async function confirmHabitAction(habit: "run" | "training", eventId: string | null, dateKey: string): Promise<void> {
  await requireUser();
  if (!["run", "training"].includes(habit) || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  const existing = await db().query.habitConfirmation.findFirst({
    where: eventId
      ? eq(habitConfirmation.eventId, eventId)
      : and(eq(habitConfirmation.habit, habit), eq(habitConfirmation.date, dateKey)),
  });
  if (!existing) await db().insert(habitConfirmation).values({ habit, eventId, date: dateKey });
  refresh();
}

export async function unconfirmHabitAction(habit: "run" | "training", dateKey: string): Promise<void> {
  await requireUser();
  await db()
    .delete(habitConfirmation)
    .where(and(eq(habitConfirmation.habit, habit), eq(habitConfirmation.date, dateKey)));
  refresh();
}
