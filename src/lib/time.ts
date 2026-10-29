import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";

// The app reasons in one timezone (APP_TIMEZONE, default Europe/Warsaw). Server code passes it in.

export function dayBounds(day: Date, tz: string): { start: Date; end: Date } {
  const start = startOfDay(new TZDate(day, tz));
  return { start: new Date(start.getTime()), end: new Date(addDays(start, 1).getTime()) };
}

/** Wall-clock time "HH:mm" on the given day in tz. */
export function atTime(day: Date, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = startOfDay(new TZDate(day, tz));
  d.setHours(h, m, 0, 0);
  return new Date(d.getTime());
}

/** ISO weekday in tz: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: Date, tz: string): number {
  const d = new TZDate(day, tz).getDay();
  return d === 0 ? 7 : d;
}

export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(date);
}

export function formatDayHeading(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(date);
}

/** Date-only (all-day) value as midnight in tz. */
export function dateOnlyInTz(year: number, month1: number, day: number, tz: string): Date {
  return new Date(new TZDate(year, month1 - 1, day, tz).getTime());
}

/** "YYYY-MM-DD" for the calendar day of `date` in tz. */
export function toDateKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Midnight in tz of a "YYYY-MM-DD" key. */
export function fromDateKey(key: string, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return dateOnlyInTz(y, m, d, tz);
}

/** Monday 00:00 → next Monday 00:00 in tz, for the week containing `day`. */
export function weekBounds(day: Date, tz: string): { start: Date; end: Date } {
  const { start: dayStart } = dayBounds(day, tz);
  const start = dayBounds(addDays(dayStart, 1 - isoWeekday(day, tz)), tz).start;
  return { start, end: dayBounds(addDays(start, 7), tz).start };
}

/** The 7 days (as midnights in tz) of the week containing `day`. */
export function weekDays(day: Date, tz: string): Date[] {
  const { start } = weekBounds(day, tz);
  return Array.from({ length: 7 }, (_, i) => dayBounds(addDays(start, i), tz).start);
}

/** First day of next month (midnight in tz) after `day`. */
export function monthEnd(day: Date, tz: string): Date {
  const d = new TZDate(day, tz);
  return new Date(new TZDate(d.getFullYear(), d.getMonth() + 1, 1, tz).getTime());
}
