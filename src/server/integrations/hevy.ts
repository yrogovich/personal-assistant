import "server-only";
import { addDays } from "date-fns";
import { eq, inArray } from "drizzle-orm";
import { toDateKey } from "@/lib/time";
import { db } from "../db/client";
import { weightLog, workout, workoutSet } from "../db/schema";
import { env } from "../env";
import { getSetting, setSetting } from "../settings";
import { AuthRevokedError, getCredentials, NotConnectedError } from "./store";

// Read-only. Public API, needs Hevy Pro. Max page size is 10. The scheduler never runs on the hour.

const API = "https://api.hevyapp.com/v1";

export type HevyCredentials = { apiKey: string };

type HevySet = {
  index: number;
  type: string;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
};
type HevyWorkout = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  updated_at: string;
  exercises: { index: number; title: string; exercise_template_id: string | null; sets: HevySet[] }[];
};
type HevyEvent = { type: "updated"; workout: HevyWorkout } | { type: "deleted"; id: string };

async function get<T>(apiKey: string, path: string, query: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) {
    throw new AuthRevokedError("Hevy rejected the API key. Check Hevy Pro and the key in Settings.");
  }
  if (res.status === 404 && path.startsWith("/body_measurements")) return { page: 1, page_count: 0, body_measurements: [] } as T;
  if (!res.ok) throw new Error(`Hevy ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** Throws if the key doesn't work. Returns the Hevy username for display. */
export async function testHevyKey(apiKey: string): Promise<string> {
  const info = await get<{ data?: { name?: string; username?: string } }>(apiKey, "/user/info");
  return info.data?.username ?? info.data?.name ?? "Hevy";
}

async function apiKey(): Promise<string> {
  const creds = await getCredentials<HevyCredentials>("hevy");
  if (!creds) throw new NotConnectedError("hevy");
  return creds.apiKey;
}

function toRows(w: HevyWorkout) {
  const sets = w.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId: w.id,
      exerciseIndex: ex.index,
      exerciseTemplateId: ex.exercise_template_id,
      exerciseTitle: ex.title,
      setIndex: s.index,
      setType: s.type,
      weightKg: s.weight_kg,
      reps: s.reps === null ? null : Math.round(s.reps),
      rpe: s.rpe,
    })),
  );
  const working = sets.filter((s) => s.setType !== "warmup");
  return {
    workout: {
      id: w.id,
      title: w.title,
      startAt: new Date(w.start_time),
      endAt: new Date(w.end_time),
      volumeKg: working.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
      setCount: working.length,
      hevyUpdatedAt: new Date(w.updated_at),
    },
    sets,
  };
}

async function upsertWorkout(w: HevyWorkout) {
  const { workout: row, sets } = toRows(w);
  await db().transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...rest } = row;
    await tx.insert(workout).values(row).onConflictDoUpdate({ target: workout.id, set: rest });
    await tx.delete(workoutSet).where(eq(workoutSet.workoutId, w.id));
    for (let i = 0; i < sets.length; i += 200) await tx.insert(workoutSet).values(sets.slice(i, i + 200));
  });
}

const FIRST_SYNC_DAYS = 365;
const MAX_PAGES = 100;

/** First run: pages back through /workouts. Later runs: /workouts/events since the last sync. */
export async function syncHevy(): Promise<number> {
  const key = await apiKey();
  const startedAt = new Date().toISOString();
  const cursor = await getSetting("hevyCursor");
  let changed = 0;

  if (!cursor) {
    const cutoff = addDays(new Date(), -FIRST_SYNC_DAYS);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await get<{ page_count: number; workouts: HevyWorkout[] }>(key, "/workouts", { page, pageSize: 10 });
      for (const w of res.workouts) {
        if (new Date(w.start_time) < cutoff) continue;
        await upsertWorkout(w);
        changed++;
      }
      const oldest = res.workouts.at(-1);
      if (page >= res.page_count || !oldest || new Date(oldest.start_time) < cutoff) break;
    }
  } else {
    // Overlap by a minute so an edit made during the previous sync isn't missed.
    const since = new Date(new Date(cursor).getTime() - 60_000).toISOString();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await get<{ page_count: number; events: HevyEvent[] }>(key, "/workouts/events", { page, pageSize: 10, since });
      const deleted: string[] = [];
      for (const ev of res.events) {
        if (ev.type === "updated") await upsertWorkout(ev.workout);
        else deleted.push(ev.id);
        changed++;
      }
      if (deleted.length) await db().delete(workout).where(inArray(workout.id, deleted));
      if (page >= res.page_count || res.events.length === 0) break;
    }
  }

  changed += await syncBodyWeight(key);
  await setSetting("hevyCursor", startedAt);
  return changed;
}

/** Recent weigh-ins from Hevy body measurements → weight_log (source "hevy"). */
async function syncBodyWeight(key: string): Promise<number> {
  const tz = env().APP_TIMEZONE;
  const cutoff = toDateKey(addDays(new Date(), -120), tz);
  let n = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await get<{ page_count: number; body_measurements: { date: string; weight_kg: number | null }[] }>(
      key,
      "/body_measurements",
      { page, pageSize: 10 },
    );
    for (const m of res.body_measurements) {
      if (m.weight_kg === null || m.date < cutoff) continue;
      await db()
        .insert(weightLog)
        .values({ date: m.date, kg: m.weight_kg, source: "hevy" })
        .onConflictDoUpdate({ target: [weightLog.date, weightLog.source], set: { kg: m.weight_kg } });
      n++;
    }
    if (page >= res.page_count || res.body_measurements.every((m) => m.date < cutoff)) break;
  }
  return n;
}
