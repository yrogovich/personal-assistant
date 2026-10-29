import "server-only";
import { and, eq, gt, lt, notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { calendar, event, type CalendarSource } from "../db/schema";
import { classifyEvent } from "../domain/event-kind";
import { getSetting } from "../settings";

export type FetchedCalendar = { externalId: string; name: string; color: string | null; defaultIncluded: boolean };
export type FetchedEvent = {
  externalId: string;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
};
export type SyncWindow = { start: Date; end: Date };

export const calendarId = (source: CalendarSource, externalId: string) => `${source}:${externalId}`;

/** Upserts the account's calendars (keeping the user's include/role choices) and drops ones that disappeared. */
export async function upsertCalendars(source: CalendarSource, fetched: FetchedCalendar[]) {
  const d = db();
  for (const c of fetched) {
    await d
      .insert(calendar)
      .values({
        id: calendarId(source, c.externalId),
        source,
        externalId: c.externalId,
        name: c.name,
        color: c.color,
        included: c.defaultIncluded,
        role: c.name.trim().toLowerCase() === "plan" && source === "google" ? "plan" : "normal",
      })
      .onConflictDoUpdate({ target: calendar.id, set: { name: c.name, color: c.color } });
  }
  const keep = fetched.map((c) => calendarId(source, c.externalId));
  await d
    .delete(calendar)
    .where(keep.length ? and(eq(calendar.source, source), notInArray(calendar.id, keep)) : eq(calendar.source, source));
  return d.query.calendar.findMany({ where: eq(calendar.source, source) });
}

/** Replaces the cached events of one calendar inside the sync window. Returns the number stored. */
export async function replaceEvents(
  cal: { id: string; role: "normal" | "plan" | "training" },
  events: FetchedEvent[],
  window: SyncWindow,
): Promise<number> {
  const keywords = await getSetting("eventKeywords");
  const rows = new Map<string, typeof event.$inferInsert>();
  for (const e of events) {
    if (e.endAt <= window.start || e.startAt >= window.end) continue;
    const id = `${cal.id}|${e.externalId}|${e.startAt.getTime()}`;
    rows.set(id, { id, calendarId: cal.id, ...e, kind: classifyEvent(e.title, cal.role, keywords) });
  }
  const values = [...rows.values()];
  await db().transaction(async (tx) => {
    await tx
      .delete(event)
      .where(and(eq(event.calendarId, cal.id), lt(event.startAt, window.end), gt(event.endAt, window.start)));
    for (let i = 0; i < values.length; i += 200) await tx.insert(event).values(values.slice(i, i + 200));
  });
  return values.length;
}

/** Excluded calendars keep no cached events. */
export async function clearEvents(calendarIdValue: string) {
  await db().delete(event).where(eq(event.calendarId, calendarIdValue));
}

export async function deleteCalendarsOf(source: CalendarSource) {
  await db().delete(calendar).where(eq(calendar.source, source)); // events cascade
}
