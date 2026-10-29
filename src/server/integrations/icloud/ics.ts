import ICAL from "ical.js";
import { dateOnlyInTz } from "@/lib/time";
import type { FetchedEvent, SyncWindow } from "../calendar-store";

const MAX_OCCURRENCES = 2000; // guards against unbounded RRULEs

function toDate(t: ICAL.Time, tz: string): Date {
  return t.isDate ? dateOnlyInTz(t.year, t.month, t.day, tz) : t.toJSDate();
}

/** Parses one CalDAV object (a VCALENDAR) and expands recurring events inside the window. */
export function expandIcs(data: string, window: SyncWindow, tz: string): FetchedEvent[] {
  const root = new ICAL.Component(ICAL.parse(data));
  for (const vtz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(vtz);

  const vevents = root.getAllSubcomponents("vevent");
  const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const out: FetchedEvent[] = [];

  const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (String(ev.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const startAt = toDate(start, tz);
    const endAt = toDate(end, tz);
    if (endAt <= window.start || startAt >= window.end) return;
    out.push({
      externalId: ev.uid,
      title: ev.summary?.trim() || "(no title)",
      location: ev.location || null,
      startAt,
      endAt: endAt > startAt ? endAt : new Date(startAt.getTime() + (start.isDate ? 86_400_000 : 0)),
      allDay: start.isDate,
    });
  };

  for (const master of masters) {
    const ev = new ICAL.Event(master);
    for (const ex of exceptions) if (ex.getFirstPropertyValue("uid") === ev.uid) ev.relateException(ex);

    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      const occ = ev.getOccurrenceDetails(next);
      if (toDate(occ.startDate, tz) >= window.end) break;
      push(occ.item, occ.startDate, occ.endDate);
    }
  }

  // Exceptions whose master lives in another object (rare, but CalDAV allows it).
  const masterUids = new Set(masters.map((m) => m.getFirstPropertyValue("uid")));
  for (const ex of exceptions) {
    if (masterUids.has(ex.getFirstPropertyValue("uid"))) continue;
    const ev = new ICAL.Event(ex);
    push(ev, ev.startDate, ev.endDate);
  }
  return out;
}
