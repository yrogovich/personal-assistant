import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { formatTime, isoWeekday, toDateKey, weekDays } from "@/lib/time";
import { db } from "../db/client";
import { calendar, event, workoutSet } from "../db/schema";
import { firstFit, freeIntervals } from "../domain/free-slots";
import { loadWeekFacts, readingStatus, rings, weekRisks } from "../domain/habits";
import { env } from "../env";
import { getSetting } from "../settings";

export async function getWeek(now = new Date()) {
  const tz = env().APP_TIMEZONE;
  const facts = await loadWeekFacts(now, tz);
  const reading = await readingStatus(now, tz);
  const hourIn = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(d));
  const risks = await weekRisks(now, tz, facts, reading, async (day, minutes) =>
    firstFit(await freeIntervals(day, tz, now), minutes, (start) => hourIn(start) >= 16),
  );

  const [rhythm, keyLifts, dayEvents, steps, goals] = await Promise.all([
    getSetting("weeklyRhythm"),
    getSetting("keyLifts"),
    db()
      .select({ id: event.id, title: event.title, start: event.startAt, end: event.endAt, allDay: event.allDay, kind: event.kind })
      .from(event)
      .innerJoin(calendar, eq(event.calendarId, calendar.id))
      .where(and(eq(calendar.included, true), lt(event.startAt, facts.end), gte(event.endAt, facts.start)))
      .orderBy(asc(event.startAt)),
    db().query.step.findMany(),
    db().query.goal.findMany(),
  ]);

  const days = weekDays(now, tz).map((d) => {
    const key = toDateKey(d, tz);
    const wd = isoWeekday(d, tz) as keyof typeof rhythm;
    return {
      key,
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: tz }).format(d),
      isToday: key === toDateKey(now, tz),
      rhythm: rhythm[wd].label,
      events: dayEvents
        .filter((e) => toDateKey(e.start, tz) === key || (e.allDay && e.start <= d && e.end > d))
        .map((e) => ({ ...e, time: e.allDay ? "all day" : formatTime(e.start, tz) })),
    };
  });

  const inWeek = (k: string | null) => !!k && k >= facts.startKey && k < facts.endKey;
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));
  const stepsDone = steps.filter((s) => s.status === "done" && inWeek(s.doneOn));
  const stepsDue = steps.filter((s) => inWeek(s.due) || (s.status === "planned" && !s.due));

  // Top set (heaviest working set) per key lift this week.
  const workoutIds = facts.workouts.map((w) => w.id);
  const sets = workoutIds.length
    ? await db().query.workoutSet.findMany({ where: (t, { inArray }) => inArray(t.workoutId, workoutIds), orderBy: asc(workoutSet.id) })
    : [];
  const lifts = keyLifts.map((name) => {
    const matching = sets.filter(
      (s) => s.setType !== "warmup" && s.exerciseTitle.toLowerCase().startsWith(name.toLowerCase()) && s.weightKg !== null,
    );
    const top = matching.sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    return { name, top: top ? { kg: top.weightKg!, reps: top.reps } : null };
  });

  return {
    tz,
    range: { start: facts.start, end: facts.end },
    rings: rings(facts, reading),
    reading,
    risks,
    unconfirmed: facts.planned.filter((p) => p.status === "unconfirmed"),
    days,
    steps: {
      done: stepsDone.map((s) => ({ ...s, goal: s.goalId ? goalTitle.get(s.goalId) : undefined })),
      due: stepsDue.map((s) => ({ ...s, goal: s.goalId ? goalTitle.get(s.goalId) : undefined })),
    },
    workouts: facts.workouts,
    runs: facts.runs,
    lifts,
    notionConnected: goals.length > 0 || steps.length > 0,
  };
}
