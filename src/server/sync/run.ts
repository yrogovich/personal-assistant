import "server-only";
import { addDays } from "date-fns";
import { eq } from "drizzle-orm";
import { dayBounds } from "@/lib/time";
import { db } from "../db/client";
import { feed, integration, syncRun, type Feed, type Provider } from "../db/schema";
import { env } from "../env";
import type { SyncWindow } from "../integrations/calendar-store";
import { syncGoogleCalendar } from "../integrations/google/calendar";
import { applyMailRules, summarizeNewMail } from "../ai/mail-summary";
import { applyGmailLabels, syncGmail } from "../integrations/google/gmail";
import { detectPaymentProblems } from "../payments";
import { syncHevy } from "../integrations/hevy";
import { syncIcloudMail } from "../integrations/icloud/imap";
import { syncIcloudCalendar } from "../integrations/icloud/caldav";
import { syncNotion } from "../integrations/notion/sync";
import { syncReminders } from "../integrations/reminders";
import { syncStrava } from "../integrations/strava";
import { getSetting } from "../settings";
import { AuthRevokedError, markIntegrationError } from "../integrations/store";

export type SyncTrigger = (typeof syncRun.$inferInsert)["trigger"];

/** `ready` returns false when the feed is connected but not usable yet (e.g. Notion before setup). */
type Syncer = { provider: Provider; run: () => Promise<number>; ready?: () => Promise<boolean> };

function calendarWindow(): SyncWindow {
  const tz = env().APP_TIMEZONE;
  const now = new Date();
  return { start: dayBounds(addDays(now, -35), tz).start, end: dayBounds(addDays(now, 14), tz).end };
}

// Feeds are added here as each integration lands.
const SYNCERS: Partial<Record<Feed, Syncer>> = {
  google_calendar: { provider: "google", run: () => syncGoogleCalendar(calendarWindow()) },
  icloud_calendar: { provider: "icloud", run: () => syncIcloudCalendar(calendarWindow()) },
  notion: { provider: "notion", run: syncNotion, ready: async () => Boolean(await getSetting("notionDataSources")) },
  strava: { provider: "strava", run: syncStrava },
  hevy: { provider: "hevy", run: syncHevy },
  reminders: { provider: "reminders", run: syncReminders },
  gmail: { provider: "google", run: () => withMailSummary(syncGmail, applyGmailLabels) },
  icloud_mail: { provider: "icloud", run: () => withMailSummary(syncIcloudMail) },
};

const warn = (what: string) => (err: unknown) => console.warn(`[mail] ${what} failed:`, err instanceof Error ? err.message : err);

/**
 * Fetch, then sort by rules, triage new threads, label them in the mailbox and check payment mail.
 * A failed step after the fetch doesn't fail the mail sync; it retries next time.
 */
async function withMailSummary(fetch: () => Promise<number>, applyLabels?: () => Promise<number>): Promise<number> {
  const n = await fetch();
  await applyMailRules().catch(warn("rules"));
  await summarizeNewMail().catch(warn("summary"));
  if (applyLabels) await applyLabels().catch(warn("labels"));
  await detectPaymentProblems().catch(warn("payment check"));
  return n;
}

export const FEED_PROVIDER: Record<Feed, Provider> = {
  google_calendar: "google",
  gmail: "google",
  icloud_calendar: "icloud",
  icloud_mail: "icloud",
  notion: "notion",
  strava: "strava",
  hevy: "hevy",
  reminders: "reminders",
};

const g = globalThis as unknown as { __paSyncing?: Set<Feed> };
const running = (g.__paSyncing ??= new Set());

export async function ensureFeed(key: Feed) {
  await db().insert(feed).values({ key }).onConflictDoNothing();
  return (await db().query.feed.findFirst({ where: eq(feed.key, key) }))!;
}

export type SyncResult = { feed: Feed; status: "ok" | "skipped" | "error"; items?: number; error?: string };

/** Syncs one feed. Never throws: failures are stored on the feed so the UI can show them. */
export async function syncFeed(key: Feed, trigger: SyncTrigger): Promise<SyncResult> {
  const syncer = SYNCERS[key];
  if (!syncer || running.has(key)) return { feed: key, status: "skipped" };

  const conn = await db().query.integration.findFirst({ where: eq(integration.provider, syncer.provider) });
  const f = await ensureFeed(key);
  if (!conn || !f.enabled) return { feed: key, status: "skipped" };
  if (syncer.ready && !(await syncer.ready())) return { feed: key, status: "skipped" };
  if (conn.status === "error" && trigger === "schedule") return { feed: key, status: "skipped" };

  running.add(key);
  const [run] = await db().insert(syncRun).values({ feed: key, trigger }).returning({ id: syncRun.id });
  try {
    const items = await syncer.run();
    const now = new Date();
    await db().update(feed).set({ lastSyncedAt: now, lastError: null }).where(eq(feed.key, key));
    await db().update(syncRun).set({ finishedAt: now, ok: true, items }).where(eq(syncRun.id, run.id));
    if (conn.status === "error") {
      await db().update(integration).set({ status: "connected", lastError: null }).where(eq(integration.provider, syncer.provider));
    }
    return { feed: key, status: "ok", items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] ${key} failed:`, message);
    await db().update(feed).set({ lastError: message }).where(eq(feed.key, key));
    await db().update(syncRun).set({ finishedAt: new Date(), ok: false, error: message }).where(eq(syncRun.id, run.id));
    if (err instanceof AuthRevokedError) await markIntegrationError(syncer.provider, message);
    return { feed: key, status: "error", error: message };
  } finally {
    running.delete(key);
  }
}

export async function syncAll(trigger: SyncTrigger): Promise<SyncResult[]> {
  return Promise.all((Object.keys(SYNCERS) as Feed[]).map((k) => syncFeed(k, trigger)));
}

export async function syncProvider(provider: Provider, trigger: SyncTrigger): Promise<SyncResult[]> {
  const keys = (Object.keys(SYNCERS) as Feed[]).filter((k) => FEED_PROVIDER[k] === provider);
  return Promise.all(keys.map((k) => syncFeed(k, trigger)));
}
