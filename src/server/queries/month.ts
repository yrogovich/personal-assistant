import "server-only";
import { addDays, differenceInCalendarDays } from "date-fns";
import { and, asc, desc, gte, inArray, lt } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { dayBounds, toDateKey, weekBounds } from "@/lib/time";
import { db } from "../db/client";
import { activity, book, goal, habitConfirmation, readingLog, reelLog, weightLog, workout, workoutSet } from "../db/schema";
import { RUN_SPORT_TYPES, STRENGTH_SPORT_TYPES } from "../integrations/strava";
import { env } from "../env";
import { getSetting } from "../settings";

export type GoalProgress = {
  id: string;
  title: string;
  category: (typeof goal.$inferSelect)["category"];
  priority: "main" | "secondary";
  measure: (typeof goal.$inferSelect)["measure"];
  targetDate: string | null;
  status: (typeof goal.$inferSelect)["status"];
  pct: number | null; // 0..1, null when it can't be measured yet
  label: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function monthRange(now: Date, tz: string) {
  const d = new TZDate(now, tz);
  const start = new Date(new TZDate(d.getFullYear(), d.getMonth(), 1, tz).getTime());
  const end = new Date(new TZDate(d.getFullYear(), d.getMonth() + 1, 1, tz).getTime());
  const prevStart = new Date(new TZDate(d.getFullYear(), d.getMonth() - 1, 1, tz).getTime());
  return { start, end, prevStart, startKey: toDateKey(start, tz), endKey: toDateKey(end, tz) };
}

/** One weigh-in per week (manual wins over Hevy on the same day), last 12 weeks. */
async function weightSeries(now: Date, tz: string) {
  const sinceKey = toDateKey(addDays(now, -84), tz);
  const rows = await db().query.weightLog.findMany({ where: gte(weightLog.date, sinceKey), orderBy: asc(weightLog.date) });
  const byWeek = new Map<string, { date: string; kg: number; source: string }>();
  for (const r of rows) {
    const wk = toDateKey(weekBounds(new Date(`${r.date}T12:00:00Z`), tz).start, tz);
    const prev = byWeek.get(wk);
    if (!prev || r.date > prev.date || (r.date === prev.date && r.source === "manual")) byWeek.set(wk, r);
  }
  return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Estimated 1RM (Epley) of the best working set per workout, per key lift, last 12 weeks. */
async function liftSeries(now: Date, tz: string) {
  const keyLifts = await getSetting("keyLifts");
  const workouts = await db().query.workout.findMany({ where: gte(workout.startAt, addDays(now, -84)), orderBy: asc(workout.startAt) });
  if (!workouts.length) return keyLifts.map((name) => ({ name, points: [] as { date: string; e1rm: number; set: string }[] }));
  const sets = await db().query.workoutSet.findMany({ where: inArray(workoutSet.workoutId, workouts.map((w) => w.id)) });
  return keyLifts.map((name) => {
    const points = workouts.flatMap((w) => {
      const best = sets
        .filter(
          (s) =>
            s.workoutId === w.id &&
            s.setType !== "warmup" &&
            s.weightKg &&
            s.reps &&
            s.exerciseTitle.toLowerCase().startsWith(name.toLowerCase()),
        )
        .map((s) => ({ e1rm: s.weightKg! * (1 + s.reps! / 30), set: `${s.weightKg} kg × ${s.reps}` }))
        .sort((a, b) => b.e1rm - a.e1rm)[0];
      return best ? [{ date: toDateKey(w.startAt, tz), e1rm: Math.round(best.e1rm * 10) / 10, set: best.set }] : [];
    });
    return { name, points };
  });
}

export async function getMonth(now = new Date()) {
  const tz = env().APP_TIMEZONE;
  const m = monthRange(now, tz);
  const todayKey = toDateKey(now, tz);

  const [goals, steps, books, reels, readings, confirmations, workouts, activities, weights, lifts] = await Promise.all([
    db().query.goal.findMany(),
    db().query.step.findMany(),
    db().query.book.findMany({ orderBy: desc(book.finishedOn) }),
    db().query.reelLog.findMany({ where: and(gte(reelLog.date, m.startKey), lt(reelLog.date, m.endKey)) }),
    db().query.readingLog.findMany({ where: and(gte(readingLog.date, m.startKey), lt(readingLog.date, m.endKey)) }),
    db().query.habitConfirmation.findMany({
      where: and(gte(habitConfirmation.date, m.startKey), lt(habitConfirmation.date, m.endKey)),
    }),
    db().query.workout.findMany({ where: and(gte(workout.startAt, m.start), lt(workout.startAt, m.end)) }),
    db().query.activity.findMany({ where: and(gte(activity.startAt, m.prevStart), lt(activity.startAt, m.end)) }),
    weightSeries(now, tz),
    liftSeries(now, tz),
  ]);

  // ── Habit heatmap (days of this month up to today) ──
  const days: string[] = [];
  for (let d = m.start; d < m.end && toDateKey(d, tz) <= todayKey; d = dayBounds(addDays(d, 1), tz).start) days.push(toDateKey(d, tz));
  const inMonth = (d: Date) => d >= m.start && d < m.end;
  const runs = activities.filter((a) => RUN_SPORT_TYPES.has(a.sportType));
  const gymDays = new Set([
    ...workouts.map((w) => toDateKey(w.startAt, tz)),
    ...activities.filter((a) => STRENGTH_SPORT_TYPES.has(a.sportType) && inMonth(a.startAt)).map((a) => toDateKey(a.startAt, tz)),
    ...confirmations.filter((c) => c.habit === "training").map((c) => c.date),
  ]);
  const runDays = new Set([
    ...runs.filter((r) => inMonth(r.startAt)).map((r) => toDateKey(r.startAt, tz)),
    ...confirmations.filter((c) => c.habit === "run").map((c) => c.date),
  ]);
  const reelDays = new Set(reels.map((r) => r.date));
  const readDays = new Set(readings.map((r) => r.date));
  const heatmap = [
    { label: "Gym", days: gymDays },
    { label: "Run", days: runDays },
    { label: "Reel", days: reelDays },
    { label: "Reading", days: readDays },
  ].map((h) => ({ label: h.label, cells: days.map((d) => ({ date: d, done: h.days.has(d) })), total: days.filter((d) => h.days.has(d)).length }));

  // ── Runs ──
  const thisMonthRuns = runs.filter((r) => inMonth(r.startAt));
  const lastMonthRuns = runs.filter((r) => r.startAt < m.start);
  const km = (rs: typeof runs) => rs.reduce((s, r) => s + (r.distanceM ?? 0), 0) / 1000;
  const runTotals = {
    count: thisMonthRuns.length,
    km: km(thisMonthRuns),
    hours: thisMonthRuns.reduce((s, r) => s + (r.movingSeconds ?? 0), 0) / 3600,
    lastMonthKm: km(lastMonthRuns),
  };

  const booksFinished = books.filter((b) => b.status === "finished" && b.finishedOn && b.finishedOn >= m.startKey && b.finishedOn < m.endKey);

  // ── Goal progress ──
  const latestWeight = weights.at(-1) ?? null;
  const weeksInMonth: { start: Date; end: Date }[] = [];
  for (let w = weekBounds(m.start, tz); w.start < m.end && w.start <= now; w = weekBounds(addDays(w.end, 1), tz)) weeksInMonth.push(w);

  const progress: GoalProgress[] = goals.map((g) => {
    const base = {
      id: g.id,
      title: g.title,
      category: g.category,
      priority: g.priority,
      measure: g.measure,
      targetDate: g.targetDate,
      status: g.status,
    };
    if (g.status === "done") return { ...base, pct: 1, label: "Done" };
    switch (g.measure) {
      case "steps": {
        const mine = steps.filter((s) => s.goalId === g.id && s.status !== "skipped");
        const done = mine.filter((s) => s.status === "done").length;
        return { ...base, pct: mine.length ? done / mine.length : null, label: mine.length ? `${done} of ${mine.length} steps` : "No steps yet" };
      }
      case "number": {
        if (g.startValue === null || g.targetValue === null) return { ...base, pct: null, label: "Set start and target in Notion" };
        const current = g.unit?.toLowerCase() === "kg" ? latestWeight?.kg : undefined;
        if (current === undefined) return { ...base, pct: null, label: `No weigh-in yet · target ${g.targetValue} ${g.unit ?? ""}` };
        const pct = clamp01((current - g.startValue) / (g.targetValue - g.startValue || 1));
        return { ...base, pct, label: `${current} ${g.unit} · from ${g.startValue} to ${g.targetValue}` };
      }
      case "habit": {
        if (g.habitPeriod === "month") {
          const target = g.habitMin ?? 1;
          const n = /read|book/i.test(g.title) ? booksFinished.length : 0;
          return { ...base, pct: clamp01(n / target), label: `${n} of ${target} this month` };
        }
        const min = g.habitMin ?? 1;
        const isReels = /reel/i.test(g.title);
        if (!isReels) return { ...base, pct: null, label: "Not tracked yet" };
        const onTarget = weeksInMonth.filter((w) => {
          const s = toDateKey(w.start, tz);
          const e = toDateKey(w.end, tz);
          return reels.filter((r) => r.date >= s && r.date < e).length >= min;
        }).length;
        // The current week only counts once it's on target.
        const finished = weeksInMonth.filter((w) => w.end <= now).length;
        const denom = Math.max(finished, onTarget, 1);
        return { ...base, pct: onTarget / denom, label: `${onTarget} of ${denom} week(s) on target this month` };
      }
      case "done":
        return { ...base, pct: 0, label: "Not yet" };
    }
  });

  const order = { fitness: 0, work: 1, personal: 2, relationship: 3 } as const;
  progress.sort(
    (a, b) =>
      (a.priority === b.priority ? 0 : a.priority === "main" ? -1 : 1) ||
      order[a.category] - order[b.category] ||
      (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999"),
  );

  return {
    tz,
    title: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: tz }).format(now),
    daysLeft: differenceInCalendarDays(m.end, dayBounds(now, tz).start),
    progress,
    weights,
    lifts,
    heatmap,
    runTotals,
    booksFinished,
  };
}
