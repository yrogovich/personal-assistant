import "server-only";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { dayBounds, toDateKey } from "@/lib/time";
import { aiConfigured } from "../ai/client";
import { db } from "../db/client";
import { dayPlan, goal, mailThread, proposedBlock, reminder, step } from "../db/schema";
import { env } from "../env";
import { gmailThreadUrl } from "../integrations/google/gmail";
import { getSetting } from "../settings";

export async function getTodayPlan(now = new Date()) {
  const tz = env().APP_TIMEZONE;
  const date = toDateKey(now, tz);
  const plans = await db().query.dayPlan.findMany({ where: eq(dayPlan.date, date), orderBy: desc(dayPlan.id) });
  const latest = plans[0] ?? null;
  const blocks = plans.length
    ? await db().query.proposedBlock.findMany({
        where: inArray(
          proposedBlock.dayPlanId,
          plans.map((p) => p.id),
        ),
        orderBy: asc(proposedBlock.startAt),
      })
    : [];
  const visible = blocks.filter(
    (b) => b.status === "approved" || (latest && b.dayPlanId === latest.id && (b.status === "proposed" || b.status === "skipped")),
  );

  const topIds = latest?.topStepIds ?? [];
  const topSteps = topIds.length ? await db().query.step.findMany({ where: inArray(step.id, topIds) }) : [];
  const goals = topSteps.length
    ? await db().query.goal.findMany({ where: inArray(goal.id, topSteps.map((s) => s.goalId!).filter(Boolean)) })
    : [];
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  const freeAtWork = await getSetting("freeAtWork");
  return {
    aiReady: await aiConfigured(),
    plan: latest ? { id: latest.id, brief: latest.brief, createdAt: latest.createdAt, trigger: latest.trigger } : null,
    blocks: visible,
    topSteps: topIds
      .map((id) => topSteps.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ ...s, goal: s.goalId ? goalTitle.get(s.goalId) : undefined })),
    freeAtWork: freeAtWork?.date === date ? freeAtWork : null,
  };
}

export async function getMail() {
  const threads = await db().query.mailThread.findMany({ orderBy: desc(mailThread.receivedAt) });
  const withLink = threads.map((t) => ({ ...t, url: t.source === "gmail" ? gmailThreadUrl(t.threadId) : null }));
  // A star suggestion on a thread that doesn't need a reply (e.g. a failed payment) is pulled out
  // of the collapsed groups so it isn't missed.
  const important = (t: (typeof withLink)[number]) => t.suggestStar && !t.starDecision && t.category !== "needs_reply";
  const rest = withLink.filter((t) => !important(t));
  return {
    needsReply: rest.filter((t) => t.category === "needs_reply"),
    important: withLink.filter(important),
    fyi: rest.filter((t) => t.category === "fyi"),
    ignore: rest.filter((t) => t.category === "ignore"),
    unsorted: rest.filter((t) => !t.category),
  };
}

export async function getDueReminders(now = new Date()) {
  const { end } = dayBounds(now, env().APP_TIMEZONE);
  const due = await db().query.reminder.findMany({ where: lt(reminder.dueAt, end), orderBy: asc(reminder.dueAt) });
  const flagged = await db().query.reminder.findMany({ where: and(eq(reminder.flagged, true)) });
  const seen = new Set(due.map((r) => r.id));
  return [...due, ...flagged.filter((r) => !seen.has(r.id))].map((r) => ({ ...r, overdue: Boolean(r.dueAt && r.dueAt < now) }));
}
