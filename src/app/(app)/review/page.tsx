import { and, desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { aiConfigured } from "@/server/ai/client";
import { reviewContext, reviewPeriod } from "@/server/ai/review";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { review } from "@/server/db/schema";
import { ReviewEditor } from "./review-editor";

export const metadata = { title: "Review · Dashboard" };

function Facts({ ctx }: { ctx: Awaited<ReturnType<typeof reviewContext>> }) {
  const items = [
    `${ctx.steps_done.length} step(s) done`,
    ctx.steps_due_not_done.length ? `${ctx.steps_due_not_done.length} due and not done` : null,
    `${ctx.training.gym_sessions} gym`,
    `${ctx.runs.count} run(s), ${ctx.runs.km} km`,
    `${ctx.reels} reel(s)`,
    ctx.reading ? `reading: page ${ctx.reading.page}${ctx.reading.total ? `/${ctx.reading.total}` : ""}` : null,
    ctx.weight ? `weight ${ctx.weight.latest_kg} kg` : null,
  ].filter(Boolean);
  return <p className="text-muted-foreground text-sm">{items.join(" · ")}</p>;
}

function Confirmed({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <Badge variant="outline">Saved to Notion</Badge>
      <div className="text-sm whitespace-pre-wrap">{text}</div>
    </div>
  );
}

export default async function ReviewPage() {
  await requireUser();
  const now = new Date();
  const [apiReady, dailyCtx, weeklyCtx] = await Promise.all([aiConfigured(), reviewContext("daily", now), reviewContext("weekly", now)]);
  const find = (type: "daily" | "weekly") =>
    db().query.review.findFirst({ where: and(eq(review.type, type), eq(review.periodStart, reviewPeriod(type, now).start)) });
  const [daily, weekly, history] = await Promise.all([
    find("daily"),
    find("weekly"),
    db().query.review.findMany({ where: eq(review.status, "confirmed"), orderBy: desc(review.periodStart), limit: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Evening check-in</h2>
          </CardTitle>
          <CardDescription>Today</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Facts ctx={dailyCtx} />
          {daily?.status === "confirmed" ? (
            <Confirmed text={daily.final ?? ""} />
          ) : (
            <ReviewEditor type="daily" draft={daily?.draft ?? null} notes={daily?.notes ?? null} source={daily?.source ?? null} apiReady={apiReady} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Weekly review</h2>
          </CardTitle>
          <CardDescription>
            {weeklyCtx.period.start} – {weeklyCtx.period.end}. Best done on Sunday.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Facts ctx={weeklyCtx} />
          {weekly?.status === "confirmed" ? (
            <Confirmed text={weekly.final ?? ""} />
          ) : (
            <ReviewEditor type="weekly" draft={weekly?.draft ?? null} notes={weekly?.notes ?? null} source={weekly?.source ?? null} apiReady={apiReady} />
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="text-lg font-semibold">
          History
        </h2>
        {history.length === 0 && <p className="text-muted-foreground text-sm">No confirmed reviews yet.</p>}
        <ul className="space-y-2">
          {history.map((r) => (
            <li key={r.id}>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {r.type === "daily" ? "Check-in" : "Weekly review"} · {r.periodStart}
                  {r.type === "weekly" ? ` – ${r.periodEnd}` : ""}
                </summary>
                <div className="mt-2 text-sm whitespace-pre-wrap">{r.final}</div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
