import Link from "next/link";
import { ConfirmSessionButton } from "@/components/confirm-session-button";
import { HabitRing } from "@/components/habit-ring";
import { SyncStatus } from "@/components/sync-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { getFeedStatuses } from "@/server/queries/integrations";
import { getWeek } from "@/server/queries/week";

export const metadata = { title: "Week · Dashboard" };

const fmtDay = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);
const fmtRange = (start: Date, end: Date, tz: string) => {
  const f = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz });
  return `${f.format(start)} – ${f.format(new Date(end.getTime() - 1))}`;
};

export default async function WeekPage() {
  await requireUser();
  const [w, feeds] = await Promise.all([getWeek(), getFeedStatuses(["notion", "strava", "hevy"])]);
  const { tz } = w;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Week of {fmtRange(w.range.start, w.range.end, tz)}</h1>
        <SyncStatus feeds={feeds} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Habits</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {w.rings.map((r) => (
              <HabitRing
                key={r.key}
                label={r.label}
                done={r.done}
                target={r.target}
                max={r.max}
                unit={r.unit}
                emptyText={r.key === "reading" ? "No book in progress" : undefined}
              />
            ))}
          </div>
          {w.reading && (
            <p className="text-muted-foreground mt-4 text-sm">
              Reading “{w.reading.book.title}”: page {w.reading.book.currentPage}
              {w.reading.book.totalPages ? ` of ${w.reading.book.totalPages}` : ""}
              {w.reading.perDayToFinish !== null ? ` · ${w.reading.perDayToFinish} pages/day to finish this month` : ""}
              {w.reading.estimatedFinish ? ` · at your pace: ${w.reading.estimatedFinish}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {(w.risks.length > 0 || w.unconfirmed.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>At risk</h2>
            </CardTitle>
            <CardDescription>Suggestions only. Nothing is added to your calendar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {w.unconfirmed.map((p) => (
              <div key={p.eventId} className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{p.title}</span>{" "}
                  <span className="text-muted-foreground">
                    {fmtDay(p.start, tz)} {formatTime(p.start, tz)}: planned, not confirmed by {p.habit === "run" ? "Strava" : "Hevy"}
                  </span>
                </div>
                <ConfirmSessionButton habit={p.habit} eventId={p.eventId} dateKey={p.dateKey}>
                  I did it
                </ConfirmSessionButton>
              </div>
            ))}
            <ul className="space-y-2">
              {w.risks.map((r, i) => (
                <li key={i} className="text-sm">
                  {r.message}
                  {r.suggestion && (
                    <span className="text-muted-foreground">
                      {" "}
                      Fit it in: {fmtDay(r.suggestion.start, tz)} {formatTime(r.suggestion.start, tz)}–
                      {formatTime(r.suggestion.end, tz)}.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Goal steps</h2>
          </CardTitle>
          <CardDescription>
            {w.steps.done.length} done this week · {w.steps.due.length} due or planned
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!w.notionConnected ? (
            <p className="text-muted-foreground text-sm">
              Connect Notion in <Link href="/settings" className="underline underline-offset-2">Settings</Link> to see goal steps.
            </p>
          ) : w.steps.done.length + w.steps.due.length === 0 ? (
            <p className="text-muted-foreground text-sm">No steps done or due this week yet. The morning plan will pick steps for you.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...w.steps.done, ...w.steps.due.filter((s) => s.status !== "done")].map((s) => (
                <li key={s.id} className="flex items-baseline gap-2 text-sm">
                  <span aria-hidden>{s.status === "done" ? "✓" : "○"}</span>
                  <span className={cn(s.status === "done" && "text-muted-foreground line-through")}>{s.title}</span>
                  {s.goal && <span className="text-muted-foreground truncate text-xs">· {s.goal}</span>}
                  <span className="sr-only">{s.status === "done" ? "(done)" : "(open)"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>This week</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {w.days.map((d) => (
              <li key={d.key} className={cn("flex gap-4 py-2", d.isToday && "font-medium")}>
                <div className="w-20 shrink-0 text-sm">
                  {d.label}
                  {d.isToday && <span className="sr-only"> (today)</span>}
                  <div className="text-muted-foreground text-xs font-normal">{d.rhythm}</div>
                </div>
                <ul className="min-w-0 flex-1 space-y-0.5 text-sm font-normal">
                  {d.events.length === 0 && <li className="text-muted-foreground">—</li>}
                  {d.events.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2">
                      <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{e.time}</span>
                      <span className="truncate">{e.title}</span>
                      {e.kind === "run" && <Badge variant="secondary">Run</Badge>}
                      {e.kind === "training" && <Badge variant="secondary">Gym</Badge>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Runs (Strava)</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {w.runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No runs recorded this week.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {w.runs.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {fmtDay(r.startAt, tz)} · {r.name}
                    </span>
                    <span className="tabular-nums">{((r.distanceM ?? 0) / 1000).toFixed(1)} km</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Gym (Hevy)</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {w.workouts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No workouts recorded this week.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {w.workouts.map((wk) => (
                  <li key={wk.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {fmtDay(wk.startAt, tz)} · {wk.title}
                    </span>
                    <span className="tabular-nums">{Math.round(wk.volumeKg).toLocaleString("en-GB")} kg</span>
                  </li>
                ))}
              </ul>
            )}
            {w.lifts.some((l) => l.top) && (
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {w.lifts
                  .filter((l) => l.top)
                  .map((l) => (
                    <li key={l.name}>
                      {l.name}: {l.top!.kg} kg × {l.top!.reps ?? "?"}
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
