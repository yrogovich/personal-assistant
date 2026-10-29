import "server-only";
import { asc } from "drizzle-orm";
import { db } from "../db/client";
import { calendar, FEEDS, type Feed, type Provider } from "../db/schema";
import { listIntegrations } from "../integrations/store";
import { FEED_PROVIDER } from "../sync/run";

export const FEED_LABEL: Record<Feed, string> = {
  google_calendar: "Google Calendar",
  icloud_calendar: "iCloud Calendar",
  gmail: "Gmail",
  icloud_mail: "iCloud Mail",
  notion: "Notion",
  strava: "Strava",
  hevy: "Hevy",
  reminders: "Reminders",
};

export type FeedStatus = {
  key: Feed;
  label: string;
  provider: Provider;
  connected: boolean;
  connectionError: string | null;
  enabled: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
};

/** Connection + sync state for the given feeds. Contains no credentials. */
export async function getFeedStatuses(keys: readonly Feed[] = FEEDS): Promise<FeedStatus[]> {
  const [conns, feeds] = await Promise.all([listIntegrations(), db().query.feed.findMany()]);
  return keys.map((key) => {
    const conn = conns.find((c) => c.provider === FEED_PROVIDER[key]);
    const f = feeds.find((x) => x.key === key);
    return {
      key,
      label: FEED_LABEL[key],
      provider: FEED_PROVIDER[key],
      connected: Boolean(conn),
      connectionError: conn?.status === "error" ? conn.lastError : null,
      enabled: f?.enabled ?? true,
      lastSyncedAt: f?.lastSyncedAt ?? null,
      lastError: f?.lastError ?? null,
    };
  });
}

export async function getCalendars() {
  return db().query.calendar.findMany({ orderBy: [asc(calendar.source), asc(calendar.name)] });
}

export { listIntegrations };
