import "server-only";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { atTime, dayBounds, isoWeekday } from "@/lib/time";
import { db } from "../db/client";
import { calendar, event, type CalendarSource, type EventKind } from "../db/schema";
import { env } from "../env";
import { getSetting } from "../settings";

export type TimelineItem = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  kind: EventKind | "work";
  source: CalendarSource | "rules";
  calendarName: string;
  color: string | null;
  location: string | null;
};

export async function getDayTimeline(day: Date): Promise<{ allDay: TimelineItem[]; timed: TimelineItem[] }> {
  const tz = env().APP_TIMEZONE;
  const { start, end } = dayBounds(day, tz);
  const rows = await db()
    .select({ e: event, c: { name: calendar.name, color: calendar.color, source: calendar.source } })
    .from(event)
    .innerJoin(calendar, eq(event.calendarId, calendar.id))
    .where(and(eq(calendar.included, true), lt(event.startAt, end), gt(event.endAt, start)))
    .orderBy(asc(event.startAt));

  const items: TimelineItem[] = rows.map(({ e, c }) => ({
    id: e.id,
    title: e.title,
    start: e.startAt,
    end: e.endAt,
    allDay: e.allDay,
    kind: e.kind,
    source: c.source,
    calendarName: c.name,
    color: c.color,
    location: e.location,
  }));

  // Work hours are a planning rule, not a calendar event, but they shape the day, so show them.
  const { workHours } = await getSetting("planningRules");
  if (workHours.days.includes(isoWeekday(day, tz))) {
    items.push({
      id: "rules:work",
      title: "Work",
      start: atTime(day, workHours.start, tz),
      end: atTime(day, workHours.end, tz),
      allDay: false,
      kind: "work",
      source: "rules",
      calendarName: "Planning rules",
      color: null,
      location: null,
    });
  }

  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  return { allDay: items.filter((i) => i.allDay), timed };
}
