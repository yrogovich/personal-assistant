import Link from "next/link";
import { SyncStatus } from "@/components/sync-status";
import { MailSummary } from "@/components/today/mail-summary";
import { PaymentAlerts } from "@/components/today/payment-alerts";
import {
  AutoPlan,
  BlockRow,
  FreeAtWorkForm,
  ReplanButton,
  StepDoneButton,
  type BlockView,
} from "@/components/today/plan-controls";
import { GymLog, ReadingLog, ReelLog, WeighIn } from "@/components/today/quick-logs";
import { Timeline } from "@/components/today/timeline";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayHeading, formatTime, isoWeekday } from "@/lib/time";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { getFeedStatuses } from "@/server/queries/integrations";
import { getQuickLogs } from "@/server/queries/logs";
import { getDueReminders, getMail, getTodayPlan } from "@/server/queries/plan";
import { getDayTimeline } from "@/server/queries/today";
import { canSortGmail } from "@/server/integrations/google/gmail";
import { getPaymentAlerts } from "@/server/payments";

export const metadata = { title: "Today · Dashboard" };

export default async function TodayPage() {
  await requireUser();
  const tz = env().APP_TIMEZONE;
  const now = new Date();
  const [{ allDay, timed }, feeds, logs, today, mail, reminders, payments, sortsGmail] = await Promise.all([
    getDayTimeline(now),
    getFeedStatuses(["google_calendar", "icloud_calendar", "gmail", "icloud_mail", "notion", "strava", "hevy", "reminders"]),
    getQuickLogs(now),
    getTodayPlan(now),
    getMail(),
    getDueReminders(now),
    getPaymentAlerts(now),
    canSortGmail(),
  ]);
  const mailConnected = feeds.some((f) => (f.key === "gmail" || f.key === "icloud_mail") && f.connected);
  const remindersConnected = feeds.some((f) => f.key === "reminders" && f.connected);
  const blocks: BlockView[] = today.blocks.map((b) => ({
    id: b.id,
    title: b.title,
    reason: b.reason,
    kind: b.kind,
    status: b.status,
    start: formatTime(b.startAt, tz),
    end: formatTime(b.endAt, tz),
  }));
  const workday = isoWeekday(now, tz) <= 5;
  const anyCalendar = feeds.some((f) => (f.key === "google_calendar" || f.key === "icloud_calendar") && f.connected);
  const calendarEvents = timed.filter((i) => i.source !== "rules").length + allDay.length;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{formatDayHeading(now, tz)}</h1>
        <SyncStatus feeds={feeds} />
      </div>

      {logs.weighIn.needed && (
        <Card>
          <CardContent>
            <WeighIn lastKg={logs.weighIn.last?.kg ?? null} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Today&apos;s plan</h2>
          </CardTitle>
          {today.plan && (
            <CardDescription>
              Suggested by {today.plan.trigger === "desktop" ? "Claude Desktop" : "Claude"} at {formatTime(today.plan.createdAt, tz)}.
              Nothing goes on your calendar until you approve it.
            </CardDescription>
          )}
          {today.aiReady && (
            <CardAction>
              <ReplanButton />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {!today.plan && !today.aiReady ? (
            <p className="text-muted-foreground text-sm">
              In Claude Desktop, pick <span className="font-medium">Plan my day</span> from the personal-dashboard prompts (or just
              ask “plan my day”). The plan appears here for you to approve. Setup is in{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>
              .
            </p>
          ) : !today.plan ? (
            <AutoPlan />
          ) : (
            <>
              <div className="space-y-1">
                {today.plan.brief.split("\n").filter(Boolean).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
              {today.topSteps.length > 0 && (
                <section aria-labelledby="top-steps" className="space-y-2">
                  <h3 id="top-steps" className="text-sm font-medium">
                    Top steps
                  </h3>
                  <ol className="space-y-1.5">
                    {today.topSteps.map((s, i) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                        <span className={s.status === "done" ? "text-muted-foreground line-through" : undefined}>{s.title}</span>
                        {s.goal && <span className="text-muted-foreground text-xs">· {s.goal}</span>}
                        {s.estimateMin && <span className="text-muted-foreground text-xs">· {s.estimateMin} min</span>}
                        {s.status !== "done" && <StepDoneButton stepId={s.id} />}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <section aria-labelledby="blocks" className="space-y-1">
                <h3 id="blocks" className="text-sm font-medium">
                  Proposed blocks
                </h3>
                {blocks.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No blocks proposed. Your free time is yours.</p>
                ) : (
                  <ul className="divide-y">
                    {blocks.map((b) => (
                      <BlockRow key={b.id} block={b} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {workday && <FreeAtWorkForm current={today.freeAtWork} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Timeline</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!anyCalendar ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">No calendars connected yet.</p>
              <Link href="/settings" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Connect calendars
              </Link>
            </div>
          ) : (
            <>
              {calendarEvents === 0 && <p className="text-muted-foreground text-sm">Nothing on your calendars today.</p>}
              <Timeline allDay={allDay} timed={timed} tz={tz} now={now} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Mail</h2>
          </CardTitle>
          <CardDescription>
            Unread from the last 3 days, Gmail and iCloud.{" "}
            {sortsGmail
              ? "Gmail threads are sorted into your folders; stars only when you press Star."
              : "Read-only. Reconnect Google in Settings to sort Gmail into folders."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mailConnected ? (
            <MailSummary mail={mail} tz={tz} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Connect Google or iCloud in{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>{" "}
              to see a mail summary.
            </p>
          )}
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Payments</h2>
            </CardTitle>
            <CardDescription>Only what needs you: due in the next few days, overdue, or a failed automatic payment.</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentAlerts alerts={payments} />
          </CardContent>
        </Card>
      )}

      {remindersConnected && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Reminders</h2>
            </CardTitle>
            <CardDescription>Due today, overdue, or flagged.</CardDescription>
          </CardHeader>
          <CardContent>
            {reminders.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing due.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {reminders.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-2">
                    <span>{r.title}</span>
                    <span className={r.overdue ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                      {r.overdue ? "overdue" : r.dueAt ? (r.allDay ? "today" : formatTime(r.dueAt, tz)) : "flagged"} · {r.list}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Quick logs</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          {logs.notionReady ? (
            <ReadingLog book={logs.reading?.book ?? null} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Connect Notion in{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>{" "}
              to log reading.
            </p>
          )}
          <ReelLog count={logs.reelsThisWeek} />
          <GymLog
            todayKey={logs.todayKey}
            recordedToday={logs.gym.recordedToday}
            confirmedToday={logs.gym.confirmedToday}
            eventId={logs.gym.eventId}
          />
          {!logs.weighIn.needed && logs.weighIn.thisWeek && (
            <p className="text-muted-foreground text-sm">
              Weight this week: {logs.weighIn.thisWeek.kg} kg ({logs.weighIn.thisWeek.source === "hevy" ? "from Hevy" : "logged"})
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
