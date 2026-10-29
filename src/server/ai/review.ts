import "server-only";
import { addDays } from "date-fns";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod/v4";
import { dayBounds, toDateKey, weekBounds } from "@/lib/time";
import { db } from "../db/client";
import { activity, dayPlan, proposedBlock, reelLog, review, weightLog, workout } from "../db/schema";
import { loadWeekFacts, readingStatus, rings, weekRisks } from "../domain/habits";
import { env } from "../env";
import { RUN_SPORT_TYPES } from "../integrations/strava";
import { models, runStructured } from "./client";

// Reviews are drafted by AI (Claude API or Claude Desktop), edited by you, and saved to Notion
// only when you press Confirm.

export type ReviewType = "daily" | "weekly";

export const REVIEW_GUIDE = {
  daily: `Write a short evening check-in (max ~120 words) in plain English, second person, as markdown:
a 1–2 line summary of the day, "- " bullets for what got done, one line on what slipped (if anything), and one
suggestion for tomorrow. Use only the facts given and the person's notes; never invent.`,
  weekly: `Write a weekly review (max ~250 words) in plain English, second person, as markdown with three sections:
"## Done", "## Slipped" and "## Focus next week" (2–3 concrete focuses tied to the main goals and the weekly targets:
2 gym sessions, 3 runs, 2–3 reels, reading pace). Use only the facts given and the person's notes; never invent.`,
};

export function reviewPeriod(type: ReviewType, now: Date) {
  const tz = env().APP_TIMEZONE;
  if (type === "daily") {
    const k = toDateKey(now, tz);
    return { start: k, end: k };
  }
  const { start, end } = weekBounds(now, tz);
  return { start: toDateKey(start, tz), end: toDateKey(addDays(end, -1), tz) };
}

/** The facts a review is written from. Same minimisation as the planner: no mail, no event titles. */
export async function reviewContext(type: ReviewType, now = new Date()) {
  const tz = env().APP_TIMEZONE;
  const period = reviewPeriod(type, now);
  const range =
    type === "daily" ? dayBounds(now, tz) : { start: weekBounds(now, tz).start, end: weekBounds(now, tz).end };
  const inRange = (k: string | null) => !!k && k >= period.start && k <= period.end;

  const [goals, steps, plans, facts, reading] = await Promise.all([
    db().query.goal.findMany(),
    db().query.step.findMany(),
    db().query.dayPlan.findMany({ where: and(gte(dayPlan.date, period.start), lt(dayPlan.date, toDateKey(range.end, tz))) }),
    loadWeekFacts(now, tz),
    readingStatus(now, tz),
  ]);
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));
  const blocks = plans.length
    ? await db().query.proposedBlock.findMany({
        where: and(inArray(proposedBlock.dayPlanId, plans.map((p) => p.id)), inArray(proposedBlock.status, ["approved", "skipped"])),
        orderBy: asc(proposedBlock.startAt),
      })
    : [];

  const [workouts, runs, reels, weights] = await Promise.all([
    db().query.workout.findMany({ where: and(gte(workout.startAt, range.start), lt(workout.startAt, range.end)) }),
    db().query.activity.findMany({ where: and(gte(activity.startAt, range.start), lt(activity.startAt, range.end)) }),
    db().query.reelLog.findMany({ where: and(gte(reelLog.date, period.start), lt(reelLog.date, toDateKey(range.end, tz))) }),
    db().query.weightLog.findMany({ where: gte(weightLog.date, toDateKey(addDays(range.start, -14), tz)), orderBy: asc(weightLog.date) }),
  ]);
  const runList = runs.filter((r) => RUN_SPORT_TYPES.has(r.sportType));

  const done = steps.filter((s) => s.status === "done" && inRange(s.doneOn));
  const slipped = steps.filter((s) => s.status !== "done" && s.status !== "skipped" && s.due && s.due <= period.end && s.due >= period.start);
  const risks = type === "weekly" ? await weekRisks(now, tz, facts, reading, async () => null) : [];

  return {
    type,
    period,
    steps_done: done.map((s) => ({ title: s.title, goal: s.goalId ? goalTitle.get(s.goalId) : null })),
    steps_due_not_done: slipped.map((s) => ({ title: s.title, goal: s.goalId ? goalTitle.get(s.goalId) : null, due: s.due })),
    main_goals: goals.filter((g) => g.priority === "main" && g.status === "active").map((g) => ({ title: g.title, target_date: g.targetDate })),
    planned_blocks: blocks.map((b) => ({ title: b.title, kind: b.kind, decision: b.status })),
    training: { gym_sessions: workouts.length, total_volume_kg: Math.round(workouts.reduce((s, w) => s + w.volumeKg, 0)) },
    runs: { count: runList.length, km: Math.round((runList.reduce((s, r) => s + (r.distanceM ?? 0), 0) / 1000) * 10) / 10 },
    reels: reels.length,
    weight: weights.length ? { latest_kg: weights.at(-1)!.kg, two_weeks_ago_kg: weights[0].kg } : null,
    reading: reading ? { book: reading.book.title, page: reading.book.currentPage, total: reading.book.totalPages, pages_this_week: reading.pagesThisWeek } : null,
    ...(type === "weekly"
      ? {
          week_targets: rings(facts, reading).map((r) => `${r.label}: ${r.done}/${r.target}${r.max ? `-${r.max}` : ""} ${r.unit}`),
          at_risk_or_missed: risks.map((r) => r.message),
        }
      : {}),
  };
}

export async function upsertReviewDraft(
  type: ReviewType,
  now: Date,
  fields: { draft: string; source: "api" | "desktop"; aiRunId: number | null; notes?: string | null },
): Promise<number> {
  const period = reviewPeriod(type, now);
  const existing = await db().query.review.findFirst({ where: and(eq(review.type, type), eq(review.periodStart, period.start)) });
  if (existing?.status === "confirmed") throw new Error("This review is already confirmed.");
  const values = { draft: fields.draft.trim(), source: fields.source, aiRunId: fields.aiRunId, ...(fields.notes !== undefined ? { notes: fields.notes } : {}) };
  if (existing) {
    await db().update(review).set(values).where(eq(review.id, existing.id));
    return existing.id;
  }
  const [row] = await db()
    .insert(review)
    .values({ type, periodStart: period.start, periodEnd: period.end, ...values })
    .returning({ id: review.id });
  return row.id;
}

const ReviewOutput = z.object({ markdown: z.string() });

export async function draftReviewViaApi(type: ReviewType, notes: string | null, now = new Date()): Promise<number> {
  const context = await reviewContext(type, now);
  const { runId, output } = await runStructured({
    job: type === "daily" ? "evening_checkin" : "weekly_review",
    model: models().plan,
    system: `You help one person reflect on their ${type === "daily" ? "day" : "week"} in their personal dashboard.\n${REVIEW_GUIDE[type]}`,
    input: { ...context, notes: notes || null },
    schema: ReviewOutput,
    effort: "medium",
    maxTokens: 8000,
  });
  return upsertReviewDraft(type, now, { draft: output.markdown, source: "api", aiRunId: runId, notes });
}

export async function hasReviewFor(type: ReviewType, now = new Date()) {
  const period = reviewPeriod(type, now);
  return Boolean(await db().query.review.findFirst({ where: and(eq(review.type, type), eq(review.periodStart, period.start)) }));
}

