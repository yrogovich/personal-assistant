import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db/client";
import { aiProposal, goal, step } from "../db/schema";
import { models, runStructured } from "./client";

// "Break into steps": the AI proposes small steps for a goal; you pick which to add to Notion.

export const STEPS_GUIDE = `Break the goal into 5–10 small, concrete steps. Each step is one sitting (15–120 minutes),
starts with a verb, and is specific enough to start without thinking. Order them. Skip steps that already exist.
Give each an estimate in minutes (15, 30, 45, 60, 90 or 120).`;

export const StepsOutput = z.object({
  steps: z.array(z.object({ title: z.string(), estimate_min: z.number() })),
});
export type ProposedSteps = z.infer<typeof StepsOutput>["steps"];

/** What the model sees: the goal and its existing steps, nothing else. */
export async function stepsContext(goalId: string) {
  const g = await db().query.goal.findFirst({ where: eq(goal.id, goalId) });
  if (!g) throw new Error("Goal not found");
  const existing = await db().query.step.findMany({ where: eq(step.goalId, goalId), orderBy: asc(step.order) });
  return {
    goal: { id: g.id, title: g.title, why: g.why, target_date: g.targetDate, measure: g.measure },
    existing_steps: existing.map((s) => ({ title: s.title, status: s.status, estimate_min: s.estimateMin })),
  };
}

export async function storeStepsProposal(
  goalId: string,
  steps: ProposedSteps,
  source: "api" | "desktop",
  aiRunId: number | null,
): Promise<number> {
  const clean = steps
    .map((s) => ({ title: s.title.trim().slice(0, 200), estimate_min: Math.min(240, Math.max(5, Math.round(s.estimate_min))) }))
    .filter((s) => s.title)
    .slice(0, 15);
  // One open proposal per goal: a newer one replaces it.
  await db()
    .update(aiProposal)
    .set({ status: "dismissed" })
    .where(and(eq(aiProposal.kind, "goal_steps"), eq(aiProposal.targetId, goalId), eq(aiProposal.status, "pending")));
  const [row] = await db()
    .insert(aiProposal)
    .values({ kind: "goal_steps", targetId: goalId, payload: { steps: clean }, source, aiRunId })
    .returning({ id: aiProposal.id });
  return row.id;
}

export async function proposeStepsViaApi(goalId: string): Promise<number> {
  const input = await stepsContext(goalId);
  const { runId, output } = await runStructured({
    job: "break_steps",
    model: models().plan,
    system: `You help one person plan their goals.\n${STEPS_GUIDE}`,
    input,
    schema: StepsOutput,
    effort: "medium",
    maxTokens: 8000,
  });
  return storeStepsProposal(goalId, output.steps, "api", runId);
}
