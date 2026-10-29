import { formatDistanceToNowStrict } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getCalendars, getFeedStatuses, listIntegrations, type FeedStatus } from "@/server/queries/integrations";
import Link from "next/link";
import { models } from "@/server/ai/client";
import { stravaConfigured } from "@/server/integrations/strava";
import { getSetting } from "@/server/settings";
import { canSortGmail } from "@/server/integrations/google/gmail";
import { listPayments } from "@/server/payments";
import {
  CalendarRow,
  DisconnectButton,
  AnthropicForm,
  FeedSwitch,
  HevyForm,
  RemindersConnect,
  IcloudForm,
  KeywordsForm,
  NotionForm,
  NotionRetryButton,
  AddPaymentForm,
  PaymentRow,
} from "./controls";

export const metadata = { title: "Settings · Dashboard" };

function FeedLine({ f }: { f: FeedStatus }) {
  const synced = f.lastSyncedAt ? `synced ${formatDistanceToNowStrict(f.lastSyncedAt, { addSuffix: true })}` : "not synced yet";
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{f.label}</div>
        <div className="text-muted-foreground text-xs">{f.enabled ? synced : "off"}</div>
        {f.lastError && <div className="text-destructive text-xs">{f.lastError}</div>}
      </div>
      <FeedSwitch feed={f.key} label={f.label} enabled={f.enabled} />
    </div>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireUser();
  const { error, connected } = await searchParams;
  const [conns, feeds, calendars, keywords, notionIds, payments, sortsGmail, mailLabels] = await Promise.all([
    listIntegrations(),
    getFeedStatuses(["google_calendar", "gmail", "icloud_calendar", "icloud_mail", "notion", "strava", "hevy", "reminders"]),
    getCalendars(),
    getSetting("eventKeywords"),
    getSetting("notionDataSources"),
    listPayments(),
    canSortGmail(),
    getSetting("mailLabels"),
  ]);
  const google = conns.find((c) => c.provider === "google");
  const icloud = conns.find((c) => c.provider === "icloud");
  const notion = conns.find((c) => c.provider === "notion");
  const strava = conns.find((c) => c.provider === "strava");
  const hevy = conns.find((c) => c.provider === "hevy");
  const anthropic = conns.find((c) => c.provider === "anthropic");
  const reminders = conns.find((c) => c.provider === "reminders");
  const envKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const m = models();
  const feed = (k: FeedStatus["key"]) => feeds.find((f) => f.key === k)!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {typeof error === "string" && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {(connected === "google" || connected === "strava") && (
        <Alert>
          <AlertDescription>{connected === "google" ? "Google" : "Strava"} connected.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Google</h2>
          </CardTitle>
          <CardDescription>
            {google
              ? `Connected as ${google.account}`
              : "Calendar, plus Gmail (unread subject, sender and snippet), sorted into your folders."}
          </CardDescription>
          <CardAction className="flex gap-2">
            {/* Plain links: the OAuth flow is a full-page redirect. */}
            <a href="/api/connect/google/start" className={buttonVariants({ variant: google ? "outline" : "default", size: "sm" })}>
              {google ? "Reconnect" : "Connect Google"}
            </a>
            {google && <DisconnectButton provider="google" label="Google" />}
          </CardAction>
        </CardHeader>
        {google && (
          <CardContent className="space-y-4">
            {google.status === "error" && <p className="text-destructive text-sm">{google.lastError}</p>}
            <FeedLine f={feed("google_calendar")} />
            <FeedLine f={feed("gmail")} />
            <p className="text-muted-foreground text-xs">
              {sortsGmail
                ? `New mail is labelled ${Object.values(mailLabels).map((n) => `“${n}”`).join(", ")}. Nothing is sent, deleted, archived or marked read; stars only when you press Star on Today.`
                : "Gmail is read-only. Press Reconnect to let the app sort new mail into your folders (labels and stars only)."}
            </p>
            <CalendarList calendars={calendars.filter((c) => c.source === "google")} />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>iCloud</h2>
          </CardTitle>
          <CardDescription>
            {icloud
              ? `Connected as ${icloud.account}`
              : "Calendar and Mail (read-only). Uses an app-specific password, never your Apple ID password."}
          </CardDescription>
          {icloud && (
            <CardAction>
              <DisconnectButton provider="icloud" label="iCloud" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!icloud ? (
            <IcloudForm />
          ) : (
            <>
              {icloud.status === "error" && (
                <p className="text-destructive text-sm">{icloud.lastError} Disconnect and connect again with a new password.</p>
              )}
              <FeedLine f={feed("icloud_calendar")} />
              <FeedLine f={feed("icloud_mail")} />
              <CalendarList calendars={calendars.filter((c) => c.source === "icloud")} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Notion</h2>
          </CardTitle>
          <CardDescription>
            {notion
              ? `Connected to “${notion.account}”. Goals, steps, books and reviews live there.`
              : "Source of truth for goals, steps, books and reviews. Uses an internal integration."}
          </CardDescription>
          {notion && (
            <CardAction>
              <DisconnectButton provider="notion" label="Notion" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!notion ? (
            <NotionForm />
          ) : (
            <>
              {notion.status === "error" && <p className="text-destructive text-sm">{notion.lastError}</p>}
              {notionIds ? <FeedLine f={feed("notion")} /> : <NotionRetryButton />}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Strava</h2>
          </CardTitle>
          <CardDescription>
            {strava ? `Connected as ${strava.account}` : "Runs, read-only. Polled on each sync."}
          </CardDescription>
          <CardAction className="flex gap-2">
            {stravaConfigured() && (
              <a
                href="/api/connect/strava/start"
                className={buttonVariants({ variant: strava ? "outline" : "default", size: "sm" })}
              >
                {strava ? "Reconnect" : "Connect Strava"}
              </a>
            )}
            {strava && <DisconnectButton provider="strava" label="Strava" />}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {!stravaConfigured() && (
            <p className="text-muted-foreground text-sm">
              Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env.local and restart (see SETUP.md).
            </p>
          )}
          {strava?.status === "error" && <p className="text-destructive text-sm">{strava.lastError}</p>}
          {strava && <FeedLine f={feed("strava")} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Hevy</h2>
          </CardTitle>
          <CardDescription>
            {hevy ? `Connected as ${hevy.account}` : "Gym workouts and weigh-ins, read-only. Needs Hevy Pro."}
          </CardDescription>
          {hevy && (
            <CardAction>
              <DisconnectButton provider="hevy" label="Hevy" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!hevy ? (
            <HevyForm />
          ) : (
            <>
              {hevy.status === "error" && <p className="text-destructive text-sm">{hevy.lastError}</p>}
              <FeedLine f={feed("hevy")} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Apple Reminders</h2>
          </CardTitle>
          <CardDescription>
            {reminders
              ? "Read from the Reminders app on this Mac. Read-only."
              : "Read-only, from the Reminders app on this Mac (iCloud doesn't serve Reminders over CalDAV any more)."}
          </CardDescription>
          {reminders && (
            <CardAction>
              <DisconnectButton provider="reminders" label="Reminders" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {reminders ? <FeedLine f={feed("reminders")} /> : <RemindersConnect />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Monthly payments</h2>
          </CardTitle>
          <CardDescription>
            Today shows a payment paid by you 3 days before its day until you mark it done, and an automatic one only when
            mail from it says the payment failed (“Mail from” is part of its sender or subject).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {payments.map((p) => (
              <PaymentRow key={p.id} p={p} />
            ))}
          </div>
          <AddPaymentForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Claude Desktop</h2>
          </CardTitle>
          <CardDescription>
            Let Claude Desktop do the AI work on your Claude subscription, through a local MCP server. It only reads summarised data and
            only writes proposals; you approve everything here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Claude Desktop → Settings → Developer → <span className="font-medium">Edit Config</span>.
            </li>
            <li>
              Add this under <code>mcpServers</code> (or run <code>pnpm mcp:config</code>), then restart Claude Desktop:
            </li>
          </ol>
          <pre className="bg-muted overflow-x-auto rounded p-3 text-xs">
            {JSON.stringify(
              { "personal-dashboard": { command: `${process.cwd()}/scripts/mcp-server.sh`, env: { NODE_BIN: process.execPath } } },
              null,
              2,
            )}
          </pre>
          <p className="text-muted-foreground text-xs">
            Then use the prompts from the “+” menu: Plan my day, Triage my mail, Draft my evening check-in, Draft my weekly review,
            Break a goal into steps. Every Desktop proposal shows up in the AI log.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Claude API</h2>
          </CardTitle>
          <CardDescription>
            Morning plan with {m.plan}, mail triage with {m.fast}. Calls run on this Mac only, with minimal data.{" "}
            <Link href="/settings/ai-log" className="underline underline-offset-2">
              AI log
            </Link>
          </CardDescription>
          {anthropic && (
            <CardAction>
              <DisconnectButton provider="anthropic" label="Claude API" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {anthropic ? (
            <p className="text-muted-foreground text-sm">Key ending {anthropic.account} is stored encrypted.</p>
          ) : envKey ? (
            <p className="text-muted-foreground text-sm">Using ANTHROPIC_API_KEY from your env file.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                Optional. Without a key, use Claude Desktop (above). With a key, the plan runs by itself at 06:30 and mail is sorted on
                every sync.
              </p>
              <AnthropicForm />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Run and gym detection</h2>
          </CardTitle>
          <CardDescription>
            Calendar events whose title starts a word with one of these count as a run or a gym session. You can also mark a
            whole calendar as &quot;Training&quot; above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordsForm run={keywords.run.join(", ")} training={keywords.training.join(", ")} />
        </CardContent>
      </Card>
    </div>
  );
}

function CalendarList({ calendars }: { calendars: Awaited<ReturnType<typeof getCalendars>> }) {
  if (calendars.length === 0) return <p className="text-muted-foreground text-sm">No calendars found yet.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-muted-foreground mb-1 text-xs">Calendars shown on the dashboard</legend>
      {calendars.map((c) => (
        <CalendarRow key={c.id} id={c.id} name={c.name} color={c.color} included={c.included} role={c.role} />
      ))}
    </fieldset>
  );
}
