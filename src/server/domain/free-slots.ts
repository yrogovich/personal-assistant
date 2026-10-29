import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { atTime, dayBounds, isoWeekday } from "@/lib/time";
import { db } from "../db/client";
import { calendar, event } from "../db/schema";
import { getSetting } from "../settings";

export type Interval = { start: Date; end: Date };

const SLOT_STEP_MS = 30 * 60_000;

/** Free time on `day` inside the block window (08–21), minus calendar events and work hours. */
export async function freeIntervals(
  day: Date,
  tz: string,
  now = new Date(),
  opts: { ignoreWorkHours?: boolean } = {},
): Promise<Interval[]> {
  const { blockWindow, workHours } = await getSetting("planningRules");
  const { start: dayStart, end: dayEnd } = dayBounds(day, tz);
  let from = atTime(day, blockWindow.start, tz);
  const to = atTime(day, blockWindow.end, tz);
  if (now > from) from = new Date(Math.ceil(now.getTime() / SLOT_STEP_MS) * SLOT_STEP_MS);
  if (from >= to) return [];

  const rows = await db()
    .select({ start: event.startAt, end: event.endAt })
    .from(event)
    .innerJoin(calendar, eq(event.calendarId, calendar.id))
    .where(and(eq(calendar.included, true), eq(event.allDay, false), lt(event.startAt, dayEnd), gt(event.endAt, dayStart)));
  const busy: Interval[] = rows.map((r) => ({ start: r.start, end: r.end }));
  if (!opts.ignoreWorkHours && workHours.days.includes(isoWeekday(day, tz))) {
    busy.push({ start: atTime(day, workHours.start, tz), end: atTime(day, workHours.end, tz) });
  }
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: Interval[] = [];
  let cursor = from;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start > cursor) free.push({ start: cursor, end: b.start < to ? b.start : to });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free;
}

/** First slot of `minutes` that starts on a half hour. */
export function firstFit(free: Interval[], minutes: number, prefer?: (start: Date) => boolean): Interval | null {
  const need = minutes * 60_000;
  const candidates: Interval[] = [];
  for (const f of free) {
    const start = new Date(Math.ceil(f.start.getTime() / SLOT_STEP_MS) * SLOT_STEP_MS);
    if (f.end.getTime() - start.getTime() >= need) candidates.push({ start, end: new Date(start.getTime() + need) });
  }
  return candidates.find((c) => prefer?.(c.start)) ?? candidates[0] ?? null;
}
