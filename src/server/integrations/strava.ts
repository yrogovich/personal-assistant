import "server-only";
import { addDays } from "date-fns";
import { and, gte, notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { activity } from "../db/schema";
import { env } from "../env";
import { AuthRevokedError, getCredentials, NotConnectedError, saveCredentials } from "./store";

// Read-only. Polled on each sync (no webhooks while the app runs locally).

const API = "https://www.strava.com/api/v3";
const SCOPE = "activity:read_all"; // includes "Only me" activities

type StravaCredentials = { accessToken: string; refreshToken: string; expiresAt: number; athlete: string };
type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds
  athlete?: { id: number; firstname?: string; lastname?: string };
};

export function stravaConfigured(): boolean {
  const e = env();
  return Boolean(e.STRAVA_CLIENT_ID && e.STRAVA_CLIENT_SECRET);
}

function clientCreds() {
  const e = env();
  if (!e.STRAVA_CLIENT_ID || !e.STRAVA_CLIENT_SECRET) throw new Error("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (see SETUP.md).");
  return { client_id: e.STRAVA_CLIENT_ID, client_secret: e.STRAVA_CLIENT_SECRET };
}

export function stravaAuthUrl(state: string): string {
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientCreds().client_id,
    redirect_uri: `${env().BETTER_AUTH_URL}/api/connect/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...clientCreds(), ...body }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new AuthRevokedError("Strava access was revoked or expired. Reconnect Strava in Settings.");
  }
  if (!res.ok) throw new Error(`Strava token request failed (${res.status})`);
  return res.json() as Promise<TokenResponse>;
}

export async function completeStravaConnect(code: string, grantedScope: string | null): Promise<void> {
  if (!grantedScope?.split(",").includes(SCOPE)) {
    throw new Error("Strava access needs “View data about your activities”, including private ones. Tick it and try again.");
  }
  const t = await tokenRequest({ code, grant_type: "authorization_code" });
  const athlete = [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(" ") || `athlete ${t.athlete?.id}`;
  const creds: StravaCredentials = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_at,
    athlete,
  };
  await saveCredentials("strava", creds, athlete);
}

/** Valid access token, refreshing (and storing the rotated refresh token) when needed. */
async function accessToken(): Promise<string> {
  const creds = await getCredentials<StravaCredentials>("strava");
  if (!creds) throw new NotConnectedError("strava");
  if (creds.expiresAt * 1000 > Date.now() + 120_000) return creds.accessToken;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: creds.refreshToken });
  await saveCredentials(
    "strava",
    { ...creds, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at },
    creds.athlete,
  );
  return t.access_token;
}

export async function revokeStrava(): Promise<void> {
  const creds = await getCredentials<StravaCredentials>("strava");
  if (!creds) return;
  await fetch("https://www.strava.com/oauth/deauthorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  }).catch(() => undefined);
}

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  external_id: string | null;
};

const FIRST_SYNC_DAYS = 90;
const RESYNC_DAYS = 14; // re-read recent activities so edits and deletions show up

export async function syncStrava(): Promise<number> {
  const token = await accessToken();
  const hasAny = await db().query.activity.findFirst();
  const since = addDays(new Date(), -(hasAny ? RESYNC_DAYS : FIRST_SYNC_DAYS));

  const fetched: StravaActivity[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${API}/athlete/activities?after=${Math.floor(since.getTime() / 1000)}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new AuthRevokedError("Strava rejected the token. Reconnect Strava in Settings.");
    if (res.status === 429) throw new Error("Strava rate limit reached; will retry on the next sync.");
    if (!res.ok) throw new Error(`Strava activities request failed (${res.status})`);
    const batch = (await res.json()) as StravaActivity[];
    fetched.push(...batch);
    if (batch.length < 100) break;
  }

  const rows = fetched.map((a) => ({
    id: String(a.id),
    name: a.name,
    sportType: a.sport_type,
    startAt: new Date(a.start_date),
    movingSeconds: a.moving_time,
    elapsedSeconds: a.elapsed_time,
    distanceM: a.distance,
    externalId: a.external_id,
  }));

  await db().transaction(async (tx) => {
    const ids = rows.map((r) => r.id);
    await tx
      .delete(activity)
      .where(ids.length ? and(gte(activity.startAt, since), notInArray(activity.id, ids)) : gte(activity.startAt, since));
    for (const r of rows) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...rest } = r;
      await tx.insert(activity).values(r).onConflictDoUpdate({ target: activity.id, set: rest });
    }
  });
  return rows.length;
}

export const RUN_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
export const STRENGTH_SPORT_TYPES = new Set(["WeightTraining", "Crossfit", "Workout"]);
