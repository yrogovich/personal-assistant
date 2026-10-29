import { asc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { aiConfigured } from "@/server/ai/client";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { aiProposal, step } from "@/server/db/schema";
import { getMonth } from "@/server/queries/month";
import { AddStepForm, BreakIntoSteps, EditGoal, GoalForm, StepStatusSelect, StepsProposal } from "./controls";

export const metadata = { title: "Goals · Dashboard" };

const CATEGORIES = [
  ["fitness", "Fitness & health"],
  ["work", "Work"],
  ["personal", "Personal"],
  ["relationship", "Relationship"],
] as const;

export default async function GoalsPage() {
  await requireUser();
  const [goals, steps, proposals, month, apiReady] = await Promise.all([
    db().query.goal.findMany(),
    db().query.step.findMany({ orderBy: asc(step.order) }),
    db().query.aiProposal.findMany({ where: eq(aiProposal.status, "pending") }),
    getMonth(),
    aiConfigured(),
  ]);
  const progress = new Map(month.progress.map((p) => [p.id, p]));
  const visible = goals.filter((g) => g.status !== "dropped");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Goals</h1>

      {goals.length === 0 && <p className="text-muted-foreground text-sm">Connect Notion in Settings to see your goals.</p>}

      {CATEGORIES.map(([cat, label]) => {
        const list = visible
          .filter((g) => g.category === cat)
          .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "main" ? -1 : 1) || (a.targetDate ?? "9").localeCompare(b.targetDate ?? "9"));
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`} className="space-y-3">
            <h2 id={`cat-${cat}`} className="text-muted-foreground text-sm font-medium">
              {label}
            </h2>
            {list.length === 0 && <p className="text-muted-foreground text-sm">No goal yet.</p>}
            {list.map((g) => {
              const mine = steps.filter((s) => s.goalId === g.id);
              const p = progress.get(g.id);
              const proposal = proposals.find((x) => x.kind === "goal_steps" && x.targetId === g.id);
              return (
                <Card key={g.id}>
                  <CardHeader>
                    <CardTitle>
                      <h3 className="flex flex-wrap items-center gap-2">
                        {g.title}
                        {g.priority === "main" && <Badge variant="secondary">Main</Badge>}
                        {g.status !== "active" && <Badge variant="outline">{g.status}</Badge>}
                      </h3>
                    </CardTitle>
                    <CardDescription>
                      {[g.why, g.targetDate && `by ${g.targetDate}`, p?.label].filter(Boolean).join(" · ")}
                    </CardDescription>
                    <CardAction>
                      <EditGoal
                        goal={{
                          id: g.id,
                          title: g.title,
                          category: g.category,
                          priority: g.priority,
                          why: g.why,
                          targetDate: g.targetDate,
                          measure: g.measure,
                          status: g.status,
                        }}
                      />
                    </CardAction>
                  </CardHeader>
                  {(g.measure === "steps" || mine.length > 0) && (
                    <CardContent className="space-y-4">
                      {mine.length > 0 && (
                        <ul className="divide-y">
                          {mine.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                              <span className={cn("text-sm", (s.status === "done" || s.status === "skipped") && "text-muted-foreground line-through")}>
                                {s.title}
                                <span className="text-muted-foreground text-xs">
                                  {s.estimateMin ? ` · ${s.estimateMin} min` : ""}
                                  {s.due ? ` · due ${s.due}` : ""}
                                </span>
                              </span>
                              <StepStatusSelect stepId={s.id} status={s.status} title={s.title} />
                            </li>
                          ))}
                        </ul>
                      )}
                      {proposal && (
                        <StepsProposal
                          proposalId={proposal.id}
                          steps={(proposal.payload as { steps: { title: string; estimate_min: number }[] }).steps}
                          source={proposal.source}
                        />
                      )}
                      <AddStepForm goalId={g.id} />
                      {!proposal && <BreakIntoSteps goalId={g.id} goalTitle={g.title} apiReady={apiReady} />}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </section>
        );
      })}

      {goals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Add a goal</h2>
            </CardTitle>
            <CardDescription>Saved to your Goals database in Notion.</CardDescription>
          </CardHeader>
          <CardContent>
            <GoalForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
