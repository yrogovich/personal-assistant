import "server-only";
import { addDays, differenceInCalendarDays } from "date-fns";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { fromDateKey, isoWeekday, monthEnd, toDateKey, weekBounds, weekDays } from "@/lib/time";
import { db } from "../db/client";
import { activity, book, calendar, event, habitConfirmation, readingLog, reelLog, workout } from "../db/schema";
import { RUN_SPORT_TYPES, STRENGTH_SPORT_TYPES } from "../integrations/strava";
import { getSetting } from "../settings";

// Matching rules (VISION.md / kickoff):
// - A planned run is done when a Strava run lands the same day.
// - A planned gym session is done when a Hevy workout lands the same day. A Strava strength activity
//   counts only on days without a Hevy workout, so a Hevy workout posted to Strava counts once (Hevy wins).
// - A calendar session with no match stays "planned, not confirmed" until confirmed by hand.

export type PlannedSession = {
  eventId: string;
  habit: "run" | "training";
  title: string;
  start: Date;
  end: Date;
  dateKey: string;
  status: "done" | "unconfirmed" | "upcoming";
};

export type Ring = { key: "training" | "run" | "reels" | "reading"; label: string; done: number; target: number; max?: number; unit: string };

export type ReadingStatus = {
  book: { id: string; title: string; totalPages: number | null; currentPage: number };
  pagesThisWeek: number;
  weekTarget: number | null;
  perDayToFinish: number | null; // pages/day needed to finish by month end
  estimatedFinish: string | null; // YYYY-MM-DD at the last 14 days' pace
} | null;

export type WeekFacts = Awaited<ReturnType<typeof loadWeekFacts>>;

export async function loadWeekFacts(now: Date, tz: string) {
  const { start, end } = weekBounds(now, tz);
  const startKey = toDateKey(start, tz);
  const endKey = toDateKey(end, tz);
  const d = db();

  const [workouts, activities, confirmations, reels, sessions] = await Promise.all([
    d.query.workout.findMany({ where: and(gte(workout.startAt, start), lt(workout.startAt, end)), orderBy: asc(workout.startAt) }),
    d.query.activity.findMany({ where: and(gte(activity.startAt, start), lt(activity.startAt, end)), orderBy: asc(activity.startAt) }),
    d.query.habitConfirmation.findMany({ where: and(gte(habitConfirmation.date, startKey), lt(habitConfirmation.date, endKey)) }),
    d.query.reelLog.findMany({ where: and(gte(reelLog.date, startKey), lt(reelLog.date, endKey)) }),
    d
      .select({ id: event.id, title: event.title, start: event.startAt, end: event.endAt, kind: event.kind })
      .from(event)
      .innerJoin(calendar, eq(event.calendarId, calendar.id))
      .where(
        and(
          eq(calendar.included, true),
          inArray(event.kind, ["run", "training"]),
          gte(event.startAt, start),
          lt(event.startAt, end),
        ),
      )
      .orderBy(asc(event.startAt)),
  ]);

  const runs = activities.filter((a) => RUN_SPORT_TYPES.has(a.sportType));
  const hevyDays = new Set(workouts.map((w) => toDateKey(w.startAt, tz)));
  const strengthDays = new Set(
    activities.filter((a) => STRENGTH_SPORT_TYPES.has(a.sportType)).map((a) => toDateKey(a.startAt, tz)),
  );
  const runDays = new Set(runs.map((r) => toDateKey(r.startAt, tz)));
  const gymDays = new Set([...hevyDays, ...strengthDays]); // a day counts once either way

  const planned: PlannedSession[] = sessions.map((s) => {
    const habit = s.kind === "run" ? "run" : "training";
    const dateKey = toDateKey(s.start, tz);
    const recorded = habit === "run" ? runDays.has(dateKey) : gymDays.has(dateKey);
    const confirmed = confirmations.some((c) => c.eventId === s.id);
    return {
      eventId: s.id,
      habit,
      title: s.title,
      start: s.start,
      end: s.end,
      dateKey,
      status: recorded || confirmed ? "done" : s.end <= now ? "unconfirmed" : "upcoming",
    };
  });

  // Manual confirmations count only where nothing was recorded that day (no double counting).
  const extraRuns = confirmations.filter((c) => c.habit === "run" && !runDays.has(c.date)).length;
  const extraGymDays = new Set(confirmations.filter((c) => c.habit === "training" && !gymDays.has(c.date)).map((c) => c.date));

  return {
    start,
    end,
    startKey,
    endKey,
    workouts,
    runs,
    runCount: runs.length + extraRuns,
    gymDays: new Set([...gymDays, ...extraGymDays]),
    reelCount: reels.length,
    planned,
  };
}

export async function currentBook() {
  return db().query.book.findFirst({ where: eq(book.status, "reading"), orderBy: [desc(book.startedOn)] });
}

/** Page reached in `bookId` before `dateKey` (exclusive), from logs, or null if none logged. */
async function pageBefore(bookId: string, dateKey: string): Promise<number | null> {
  const row = await db().query.readingLog.findFirst({
    where: and(eq(readingLog.bookId, bookId), lt(readingLog.date, dateKey)),
    orderBy: [desc(readingLog.date), desc(readingLog.id)],
  });
  return row?.page ?? null;
}

export async function readingStatus(now: Date, tz: string): Promise<ReadingStatus> {
  const b = await currentBook();
  if (!b) return null;
  const { start } = weekBounds(now, tz);
  const startKey = toDateKey(start, tz);
  const todayKey = toDateKey(now, tz);
  const latest = await db().query.readingLog.findFirst({
    where: eq(readingLog.bookId, b.id),
    orderBy: [desc(readingLog.date), desc(readingLog.id)],
  });
  const currentPage = Math.max(latest?.page ?? 0, b.currentPage ?? 0);
  const atWeekStart = (await pageBefore(b.id, startKey)) ?? (b.startedOn && b.startedOn >= startKey ? 0 : null);
  const pagesThisWeek = atWeekStart === null ? 0 : Math.max(0, currentPage - atWeekStart);

  let weekTarget: number | null = null;
  let perDayToFinish: number | null = null;
  let estimatedFinish: string | null = null;
  if (b.totalPages) {
    const mEnd = monthEnd(start, tz);
    const daysLeftFromWeekStart = Math.max(1, differenceInCalendarDays(mEnd, start));
    const daysOfWeekInMonth = Math.min(7, daysLeftFromWeekStart);
    const leftAtWeekStart = Math.max(0, b.totalPages - (atWeekStart ?? currentPage));
    weekTarget = Math.ceil((leftAtWeekStart / daysLeftFromWeekStart) * daysOfWeekInMonth);

    const daysLeftFromToday = Math.max(1, differenceInCalendarDays(monthEnd(now, tz), fromDateKey(todayKey, tz)));
    perDayToFinish = Math.ceil(Math.max(0, b.totalPages - currentPage) / daysLeftFromToday);

    const twoWeeksAgo = toDateKey(addDays(now, -14), tz);
    const before = (await pageBefore(b.id, twoWeeksAgo)) ?? 0;
    const pace = (currentPage - before) / 14;
    if (pace > 0 && currentPage < b.totalPages) {
      estimatedFinish = toDateKey(addDays(now, Math.ceil((b.totalPages - currentPage) / pace)), tz);
    }
  }
  return {
    book: { id: b.id, title: b.title, totalPages: b.totalPages, currentPage },
    pagesThisWeek,
    weekTarget,
    perDayToFinish,
    estimatedFinish,
  };
}

export function rings(facts: WeekFacts, reading: ReadingStatus): Ring[] {
  return [
    { key: "training", label: "Gym", done: facts.gymDays.size, target: 2, unit: "sessions" },
    { key: "run", label: "Runs", done: facts.runCount, target: 3, unit: "runs" },
    { key: "reels", label: "Reels", done: facts.reelCount, target: 2, max: 3, unit: "reels" },
    {
      key: "reading",
      label: "Reading",
      done: reading?.pagesThisWeek ?? 0,
      target: reading?.weekTarget ?? 0,
      unit: "pages",
    },
  ];
}

export type RiskItem = {
  habit: Ring["key"];
  message: string;
  /** A free slot to fit the missing session in (suggestion only; nothing is written). */
  suggestion?: { dateKey: string; start: Date; end: Date; label: string };
};

/** Deterministic week guard: what's at risk and where it could still fit. */
export async function weekRisks(
  now: Date,
  tz: string,
  facts: WeekFacts,
  reading: ReadingStatus,
  freeSlot: (day: Date, minutes: number) => Promise<{ start: Date; end: Date } | null>,
): Promise<RiskItem[]> {
  const rhythm = await getSetting("weeklyRhythm");
  const days = weekDays(now, tz);
  const todayKey = toDateKey(now, tz);
  const out: RiskItem[] = [];
  const dayName = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: tz }).format(d);

  for (const habit of ["run", "training"] as const) {
    const slot = habit === "run" ? "run" : "gym";
    const target = habit === "run" ? 3 : 2;
    const done = habit === "run" ? facts.runCount : facts.gymDays.size;
    if (done >= target) continue;

    const recordedOn = (key: string) =>
      habit === "run" ? facts.runs.some((r) => toDateKey(r.startAt, tz) === key) : facts.gymDays.has(key);

    for (const day of days) {
      const key = toDateKey(day, tz);
      const wd = isoWeekday(day, tz) as keyof typeof rhythm;
      if (rhythm[wd].slot !== slot) continue;
      const plannedThatDay = facts.planned.some((p) => p.habit === habit && p.dateKey === key);
      if (key < todayKey) {
        // Past rhythm day with nothing recorded: flag only (no catch-up suggestions, except Thursday gym below).
        const tuesdayGymWithCatchUp = habit === "training" && wd === 2 && isoWeekday(now, tz) <= 4;
        if (tuesdayGymWithCatchUp) continue;
        if (!recordedOn(key) && !facts.planned.some((p) => p.habit === habit && p.dateKey === key && p.status === "done")) {
          out.push({ habit, message: `${dayName(day)}: ${rhythm[wd].label.toLowerCase()} missed.` });
        }
        continue;
      }
      if (plannedThatDay || recordedOn(key)) continue;
      const minutes = habit === "run" ? 60 : 75;
      const fit = await freeSlot(day, minutes);
      out.push({
        habit,
        message: `No ${habit === "run" ? "run" : "gym session"} planned for ${dayName(day)} (${rhythm[wd].label}).`,
        suggestion: fit ? { dateKey: key, ...fit, label: rhythm[wd].label } : undefined,
      });
    }
  }

  // Thursday is the gym catch-up slot, only when Tuesday's session was missed.
  const tuesday = days[1];
  const thursday = days[3];
  const tueKey = toDateKey(tuesday, tz);
  const thuKey = toDateKey(thursday, tz);
  if (todayKey > tueKey && todayKey <= thuKey && !facts.gymDays.has(tueKey) && !facts.gymDays.has(thuKey)) {
    const plannedThu = facts.planned.some((p) => p.habit === "training" && p.dateKey === thuKey);
    if (!plannedThu) {
      const fit = await freeSlot(thursday, 75);
      out.push({
        habit: "training",
        message: "Tuesday's gym session was missed. Thursday is the catch-up slot.",
        suggestion: fit ? { dateKey: thuKey, ...fit, label: "Gym (catch-up)" } : undefined,
      });
    }
  }

  const daysLeft = days.filter((d) => toDateKey(d, tz) >= todayKey).length;
  if (facts.reelCount < 2 && 2 - facts.reelCount >= daysLeft) {
    out.push({ habit: "reels", message: `${2 - facts.reelCount} reel(s) to go and ${daysLeft} day(s) left this week.` });
  }

  if (reading?.weekTarget) {
    const elapsed = 7 - daysLeft + 1;
    const expected = Math.floor((reading.weekTarget * elapsed) / 7);
    if (reading.pagesThisWeek < expected) {
      out.push({
        habit: "reading",
        message: `Reading is behind: ${reading.pagesThisWeek} of ~${expected} pages so far. ${reading.perDayToFinish ?? "?"} pages/day finishes the book this month.`,
      });
    }
  }
  return out;
}
