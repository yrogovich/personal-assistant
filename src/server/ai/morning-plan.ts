import "server-only";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod/v4";
import { atTime, dayBounds, formatTime, isoWeekday, toDateKey } from "@/lib/time";
import { db } from "../db/client";
import { BLOCK_KINDS, calendar, dayPlan, event, mailThread, proposedBlock, reminder, step } from "../db/schema";
import { freeIntervals, type Interval } from "../domain/free-slots";
import { loadWeekFacts, readingStatus, rings, weekRisks } from "../domain/habits";
import { env } from "../env";
import { getSetting } from "../settings";
import { models, runStructured } from "./client";

// The model only proposes. Blocks are stored as "proposed" and reach Google Calendar only when
// you press Approve (see actions/plan.ts). Inputs are minimised: free/busy times without event
// titles (except your run/gym sessions), open steps, weekly progress, due reminders, and the
// subjects/senders of mail that needs a reply.

export const PLAN_SYSTEM = `You plan one day for one person, inside their personal dashboard. You only propose; they approve each block.

Rules you must follow:
- Place blocks only inside the given free_slots (times are local, 24h "HH:mm"). Never overlap busy times or each other.
- Work hours are busy. The only exception: if free_at_work is set, learning steps (courses, certifications) may go inside that window.
- Weekly rhythm decides workouts: put a run or gym block only if today's rhythm calls for it (or week_progress.at_risk asks for a catch-up today), and only if one isn't already on the calendar or done.
- Typical lengths: run 45–75 min, gym 75 min, reading 30 min, a step uses its estimate_min.
- Prefer steps from main goals, then earlier target dates, then lower order. Don't schedule more than one step from the same goal back to back unless the slot is long.
- Leave breathing room: 3–5 blocks is plenty. Don't fill every free minute; keep evenings after 20:00 light.
- Add a reading block when reading is behind pace.

Write the brief as 3–5 short lines (separated by "\\n"), plain English, second person, no greetings: what matters today, what's at risk this week, any mail that needs a reply. Do not invent facts.
top_step_ids: up to 3 ids from open_steps that matter most today.
Each block gets a short title and a one-sentence reason.`;

export const PlanOutput = z.object({
  brief: z.string(),
  top_step_ids: z.array(z.string()),
  blocks: z.array(
    z.object({
      start: z.string().describe('Local start time "HH:mm"'),
      end: z.string().describe('Local end time "HH:mm"'),
      kind: z.enum(BLOCK_KINDS),
      title: z.string(),
      step_id: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});

const LEARNING = /certif|course|lesson|academy|claude 101|fluency|building with the claude api|model context protocol/i;

const hhmm = (d: Date, tz: string) => formatTime(d, tz);

async function busyToday(day: Date, tz: string) {
  const { start, end } = dayBounds(day, tz);
  const rows = await db()
    .select({ start: event.startAt, end: event.endAt, kind: event.kind, title: event.title })
    .from(event)
    .innerJoin(calendar, eq(event.calendarId, calendar.id))
    .where(and(eq(calendar.included, true), eq(event.allDay, false), lt(event.startAt, end), gte(event.endAt, start)))
    .orderBy(asc(event.startAt));
  return rows.map((r) => ({
    start: hhmm(r.start, tz),
    end: hhmm(r.end, tz),
    kind: r.kind,
    // Titles only for your own workout/plan events; everything else is just "busy".
    ...(r.kind === "other" ? {} : { title: r.title }),
  }));
}

async function openSteps() {
  const [all, goals] = await Promise.all([
    db().query.step.findMany({ where: inArray(step.status, ["todo", "planned"]), orderBy: asc(step.order) }),
    db().query.goal.findMany(),
  ]);
  const goalById = new Map(goals.filter((g) => g.status === "active").map((g) => [g.id, g]));
  const perGoal = new Map<string, number>();
  return all
    .filter((s) => s.goalId && goalById.has(s.goalId))
    .sort((a, b) => {
      const ga = goalById.get(a.goalId!)!;
      const gb = goalById.get(b.goalId!)!;
      if (ga.priority !== gb.priority) return ga.priority === "main" ? -1 : 1;
      return (ga.targetDate ?? "9999").localeCompare(gb.targetDate ?? "9999") || (a.order ?? 0) - (b.order ?? 0);
    })
    .filter((s) => {
      const n = perGoal.get(s.goalId!) ?? 0;
      perGoal.set(s.goalId!, n + 1);
      return n < 3; // the next three steps of each goal is enough context
    })
    .slice(0, 20)
    .map((s) => {
      const g = goalById.get(s.goalId!)!;
      return {
        id: s.id,
        title: s.title,
        goal: g.title,
        goal_priority: g.priority,
        goal_target_date: g.targetDate,
        estimate_min: s.estimateMin ?? 60,
        due: s.due,
        learning: LEARNING.test(g.title) || LEARNING.test(s.title),
      };
    });
}

export async function buildPlanInput(now: Date) {
  const tz = env().APP_TIMEZONE;
  const todayKey = toDateKey(now, tz);
  const [rules, rhythm, freeAtWork, facts, reading] = await Promise.all([
    getSetting("planningRules"),
    getSetting("weeklyRhythm"),
    getSetting("freeAtWork"),
    loadWeekFacts(now, tz),
    readingStatus(now, tz),
  ]);
  const free = await freeIntervals(now, tz, now);
  const risks = await weekRisks(now, tz, facts, reading, async () => null);
  const wd = isoWeekday(now, tz) as keyof typeof rhythm;
  const { end: dayEnd } = dayBounds(now, tz);

  const [steps, busy, reminders, needsReply, mailCounts] = await Promise.all([
    openSteps(),
    busyToday(now, tz),
    db().query.reminder.findMany({ where: lt(reminder.dueAt, dayEnd), orderBy: asc(reminder.dueAt), limit: 15 }),
    db().query.mailThread.findMany({ where: eq(mailThread.category, "needs_reply"), orderBy: desc(mailThread.receivedAt), limit: 10 }),
    db().query.mailThread.findMany({ columns: { category: true } }),
  ]);

  const atWork = freeAtWork && freeAtWork.date === todayKey ? freeAtWork : null;
  return {
    tz,
    free,
    steps,
    atWork,
    input: {
      today: {
        date: todayKey,
        weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: tz }).format(now),
        now: hhmm(now, tz),
      },
      rules: {
        blocks_between: `${rules.blockWindow.start}–${rules.blockWindow.end}`,
        work_hours: rules.workHours.days.includes(wd) ? `${rules.workHours.start}–${rules.workHours.end}` : "none today",
        rhythm_today: rhythm[wd].label,
        free_at_work: atWork ? { start: atWork.start, end: atWork.end } : null,
      },
      free_slots: free.map((f) => ({ start: hhmm(f.start, tz), end: hhmm(f.end, tz) })),
      busy,
      week_progress: {
        ...Object.fromEntries(rings(facts, reading).map((r) => [r.label.toLowerCase(), `${r.done}/${r.target}${r.max ? `-${r.max}` : ""} ${r.unit}`])),
        at_risk: risks.map((r) => r.message),
      },
      reading: reading
        ? {
            book: reading.book.title,
            page: reading.book.currentPage,
            total_pages: reading.book.totalPages,
            pages_per_day_to_finish_this_month: reading.perDayToFinish,
          }
        : null,
      open_steps: steps,
      reminders_due: reminders.map((r) => ({
        title: r.title,
        due: r.dueAt ? (r.dueAt < now ? "overdue" : r.allDay ? "today" : `today ${hhmm(r.dueAt, tz)}`) : "flagged",
      })),
      mail: {
        needs_reply: needsReply.map((m) => ({ from: m.sender.replace(/<.*>/, "").trim() || m.sender, subject: m.subject })),
        fyi: mailCounts.filter((m) => m.category === "fyi").length,
        ignore: mailCounts.filter((m) => m.category === "ignore").length,
      },
    },
  };
}

const parseHHMM = (s: string) => (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(s.trim()) ? s.trim().padStart(5, "0") : null);
const inside = (a: Interval, b: Interval) => a.start >= b.start && a.end <= b.end;
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export type PlanTrigger = "schedule" | "first_open" | "replan";

/**
 * Generates and stores a new plan for today. Proposed blocks from earlier plans today are superseded;
 * approved ones stay (they're on the calendar and count as busy).
 */
export async function generateMorningPlan(trigger: PlanTrigger, now = new Date()): Promise<{ planId: number; dropped: number }> {
  const { tz, free, steps, atWork, input } = await buildPlanInput(now);
  const { runId, output } = await runStructured({
    job: "morning_plan",
    model: models().plan,
    system: PLAN_SYSTEM,
    input,
    schema: PlanOutput,
    effort: "medium",
  });
  return storePlan(output, trigger, runId, { now, tz, free, steps, atWork });
}

/**
 * Validates a plan against the real free time and stores it as proposals. Shared by the Claude API
 * path and the Claude Desktop (MCP) path, so both obey the same rules.
 */
export async function storePlan(
  output: z.infer<typeof PlanOutput>,
  trigger: PlanTrigger | "desktop",
  runId: number | null,
  ctx: Pick<Awaited<ReturnType<typeof buildPlanInput>>, "tz" | "free" | "steps" | "atWork"> & { now: Date },
): Promise<{ planId: number; dropped: number }> {
  const { now, tz, free, steps, atWork } = ctx;
  // Validate against the real free time. Anything that doesn't fit is dropped (and counted).
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const workWindow = atWork ? { start: atTime(now, atWork.start, tz), end: atTime(now, atWork.end, tz) } : null;
  // Inside the free-at-work window, calendar events (meetings) still count as busy.
  const freeIgnoringWork = workWindow ? await freeIntervals(now, tz, now, { ignoreWorkHours: true }) : [];
  const accepted: { start: Date; end: Date; kind: (typeof BLOCK_KINDS)[number]; title: string; stepId: string | null; reason: string }[] = [];
  for (const b of output.blocks) {
    const s = parseHHMM(b.start);
    const e = parseHHMM(b.end);
    if (!s || !e) continue;
    const block = { start: atTime(now, s, tz), end: atTime(now, e, tz) };
    if (block.end <= block.start || block.start < now) continue;
    const step = b.step_id ? stepById.get(b.step_id) : undefined;
    const fitsFree = free.some((f) => inside(block, f));
    const fitsWork = Boolean(
      workWindow && step?.learning && inside(block, workWindow) && freeIgnoringWork.some((f) => inside(block, f)),
    );
    if (!fitsFree && !fitsWork) continue;
    if (accepted.some((a) => overlaps(a, block))) continue;
    accepted.push({
      ...block,
      kind: b.kind === "step" && !step ? "other" : b.kind,
      title: b.title.slice(0, 120),
      stepId: step ? step.id : null,
      reason: b.reason.slice(0, 300),
    });
  }

  const date = toDateKey(now, tz);
  const topStepIds = output.top_step_ids.filter((id) => stepById.has(id)).slice(0, 3);
  const planId = await db().transaction(async (tx) => {
    const todays = await tx.query.dayPlan.findMany({ where: eq(dayPlan.date, date), columns: { id: true } });
    if (todays.length) {
      await tx
        .update(proposedBlock)
        .set({ status: "superseded" })
        .where(and(inArray(proposedBlock.dayPlanId, todays.map((p) => p.id)), eq(proposedBlock.status, "proposed")));
    }
    const [plan] = await tx
      .insert(dayPlan)
      .values({ date, trigger, brief: output.brief.trim(), topStepIds, aiRunId: runId })
      .returning({ id: dayPlan.id });
    if (accepted.length) {
      await tx.insert(proposedBlock).values(
        accepted.map((a) => ({
          dayPlanId: plan.id,
          startAt: a.start,
          endAt: a.end,
          kind: a.kind,
          title: a.title,
          stepId: a.stepId,
          reason: a.reason,
        })),
      );
    }
    return plan.id;
  });
  return { planId, dropped: output.blocks.length - accepted.length };
}

// Single-flight: the 06:30 job, the first open of the day and Replan never run two plans at once.
const g = globalThis as unknown as { __paPlanning?: Promise<{ planId: number; dropped: number }> };

export function generateOnce(trigger: PlanTrigger): Promise<{ planId: number; dropped: number }> {
  if (!g.__paPlanning) {
    g.__paPlanning = generateMorningPlan(trigger).finally(() => {
      g.__paPlanning = undefined;
    });
  }
  return g.__paPlanning;
}

export async function hasPlanFor(dateKey: string): Promise<boolean> {
  return Boolean(await db().query.dayPlan.findFirst({ where: eq(dayPlan.date, dateKey), columns: { id: true } }));
}
