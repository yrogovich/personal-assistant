import "server-only";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { dayBounds, isoWeekday, toDateKey, weekBounds } from "@/lib/time";
import { db } from "../db/client";
import { calendar, event, habitConfirmation, weightLog, workout } from "../db/schema";
import { loadWeekFacts, readingStatus } from "../domain/habits";
import { env } from "../env";
import { listIntegrations } from "../integrations/store";
import { getSetting } from "../settings";

/** Everything the Today quick-log card needs. */
export async function getQuickLogs(now = new Date()) {
  const tz = env().APP_TIMEZONE;
  const todayKey = toDateKey(now, tz);
  const { start: dayStart, end: dayEnd } = dayBounds(now, tz);
  const week = weekBounds(now, tz);
  const weekStartKey = toDateKey(week.start, tz);

  const [reading, facts, weights, gymToday, confirmedGymToday, trainingEventToday, conns, notionIds] = await Promise.all([
    readingStatus(now, tz),
    loadWeekFacts(now, tz),
    db().query.weightLog.findMany({ where: gte(weightLog.date, weekStartKey), orderBy: desc(weightLog.date) }),
    db().query.workout.findFirst({ where: and(gte(workout.startAt, dayStart), lt(workout.startAt, dayEnd)) }),
    db().query.habitConfirmation.findFirst({
      where: and(eq(habitConfirmation.habit, "training"), eq(habitConfirmation.date, todayKey)),
    }),
    db()
      .select({ id: event.id })
      .from(event)
      .innerJoin(calendar, eq(event.calendarId, calendar.id))
      .where(
        and(eq(calendar.included, true), inArray(event.kind, ["training"]), gte(event.startAt, dayStart), lt(event.startAt, dayEnd)),
      )
      .limit(1),
    listIntegrations(),
    getSetting("notionDataSources"),
  ]);

  const lastWeight = await db().query.weightLog.findFirst({ orderBy: desc(weightLog.date) });
  const weightThisWeek = weights[0] ?? null;

  return {
    todayKey,
    reading,
    notionReady: Boolean(notionIds) && conns.some((c) => c.provider === "notion"),
    reelsThisWeek: facts.reelCount,
    weighIn: {
      // Asked from Monday until entered; a Hevy weigh-in this week counts.
      needed: !weightThisWeek,
      isMonday: isoWeekday(now, tz) === 1,
      thisWeek: weightThisWeek,
      last: lastWeight ?? null,
    },
    gym: {
      recordedToday: Boolean(gymToday),
      confirmedToday: Boolean(confirmedGymToday),
      plannedToday: trainingEventToday.length > 0,
      eventId: trainingEventToday[0]?.id ?? null,
    },
  };
}
