import { HabitHeatmap } from "@/components/charts/habit-heatmap";
import { DataTable, LineChart, type Point } from "@/components/charts/line-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getMonth, type GoalProgress } from "@/server/queries/month";
import { getPaymentSummary } from "@/server/payments";
import Link from "next/link";

export const metadata = { title: "Month · Dashboard" };

const CATEGORY_LABEL: Record<GoalProgress["category"], string> = {
  fitness: "Fitness & health",
  work: "Work",
  personal: "Personal",
  relationship: "Relationship",
};

const short = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
};

function ProgressBar({ pct }: { pct: number | null }) {
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden>
      {pct !== null && <div className="bg-foreground h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%` }} />}
    </div>
  );
}

function GoalRow({ g }: { g: GoalProgress }) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{g.title}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {g.pct !== null ? `${Math.round(g.pct * 100)}%` : "–"}
          {g.targetDate ? ` · by ${short(g.targetDate)}` : ""}
        </span>
      </div>
      <ProgressBar pct={g.pct} />
      <div className="text-muted-foreground text-xs">{g.label}</div>
    </li>
  );
}

export default async function MonthPage() {
  await requireUser();
  const [m, pay] = await Promise.all([getMonth(), getPaymentSummary()]);
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  const main = m.progress.filter((g) => g.priority === "main" && g.status === "active");
  const secondary = m.progress.filter((g) => g.priority === "secondary" && g.status === "active");
  const byCategory = (list: GoalProgress[]) =>
    (["fitness", "work", "personal", "relationship"] as const)
      .map((c) => ({ c, goals: list.filter((g) => g.category === c) }))
      .filter((x) => x.goals.length);

  const weightPoints: Point[] = m.weights.map((w) => ({ label: short(w.date), value: w.kg, detail: w.source === "hevy" ? "Hevy" : undefined }));
  const weightGoal = m.progress.find((g) => g.measure === "number");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{m.title}</h1>
        <p className="text-muted-foreground text-sm">{m.daysLeft} day(s) left this month</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Goals</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {m.progress.length === 0 && <p className="text-muted-foreground text-sm">Connect Notion in Settings to see goals.</p>}
          {main.length > 0 && (
            <section aria-labelledby="main-goals" className="space-y-3">
              <h3 id="main-goals" className="flex items-center gap-2 text-sm font-medium">
                Main <Badge variant="secondary">focus</Badge>
              </h3>
              <ul className="space-y-4">
                {main.map((g) => (
                  <GoalRow key={g.id} g={g} />
                ))}
              </ul>
            </section>
          )}
          {byCategory(secondary).map(({ c, goals }) => (
            <section key={c} aria-labelledby={`cat-${c}`} className="space-y-3">
              <h3 id={`cat-${c}`} className="text-muted-foreground text-sm font-medium">
                {CATEGORY_LABEL[c]}
              </h3>
              <ul className="space-y-4">
                {goals.map((g) => (
                  <GoalRow key={g.id} g={g} />
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Habits this month</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HabitHeatmap rows={m.heatmap} />
        </CardContent>
      </Card>

      <Card>
          <CardHeader>
            <CardTitle>
              <h2>Weight</h2>
            </CardTitle>
            <CardDescription>
              Weekly weigh-ins, last 12 weeks{weightGoal ? ` · ${weightGoal.label}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <LineChart points={weightPoints} unit="kg" ariaLabel="Weekly weight, last 12 weeks" />
            <DataTable points={weightPoints} unit="kg" caption="Weekly weight" />
          </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Runs (Strava)</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-muted-foreground text-xs">Runs</dt>
                <dd className="text-2xl font-semibold tabular-nums">{m.runTotals.count}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Distance</dt>
                <dd className="text-2xl font-semibold tabular-nums">{m.runTotals.km.toFixed(1)} km</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Time</dt>
                <dd className="text-2xl font-semibold tabular-nums">{m.runTotals.hours.toFixed(1)} h</dd>
              </div>
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">Last month: {m.runTotals.lastMonthKm.toFixed(1)} km</p>
          </CardContent>
        </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Key lifts (Hevy)</h2>
          </CardTitle>
          <CardDescription>Estimated 1-rep max of the best working set per workout, last 12 weeks.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-6 sm:grid-cols-2">
            {m.lifts.map((l) => {
              const pts: Point[] = l.points.map((p) => ({ label: short(p.date), value: p.e1rm, detail: p.set }));
              const first = pts[0]?.value;
              const last = pts.at(-1)?.value;
              return (
                <li key={l.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{l.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {last !== undefined ? `${last} kg e1RM` : "no sets"}
                      {first !== undefined && last !== undefined && pts.length > 1
                        ? ` · ${last - first >= 0 ? "+" : ""}${Math.round((last - first) * 10) / 10}`
                        : ""}
                    </span>
                  </div>
                  <LineChart points={pts} unit="kg e1RM" compact height={56} ariaLabel={`${l.name} estimated 1RM trend`} />
                  <DataTable points={pts} unit="kg e1RM" caption={`${l.name} estimated 1RM`} />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Books finished</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {m.booksFinished.length === 0 ? (
            <p className="text-muted-foreground text-sm">None yet this month.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {m.booksFinished.map((b) => (
                <li key={b.id}>
                  {b.title}
                  <span className="text-muted-foreground text-xs"> · {b.totalPages} pages · finished {b.finishedOn && short(b.finishedOn)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pay.count > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Payments</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {pay.count} monthly payment(s)
              {pay.totals.length > 0 && <> · about {pay.totals.map((t) => money(t.amount, t.currency)).join(" + ")} a month</>}
              {pay.problems > 0 && <span className="text-destructive"> · {pay.problems} failed</span>}
            </p>
            {pay.missingAmounts > 0 && (
              <p className="text-muted-foreground text-xs">
                {pay.missingAmounts} without an amount yet.{" "}
                <Link href="/settings" className="underline underline-offset-2">
                  Add them in Settings
                </Link>
              </p>
            )}
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs">Show all</summary>
              <ul className="mt-2 space-y-1">
                {pay.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap gap-x-2">
                    <span>{p.name}</span>
                    <span className="text-muted-foreground text-xs">
                      day {p.dayOfMonth} · {p.method === "auto" ? "automatic" : "by you"}
                      {p.amount !== null && ` · ${money(p.amount, p.currency)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
