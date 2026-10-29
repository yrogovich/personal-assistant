import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { setting } from "./db/schema";

export type EventKeywords = { run: string[]; training: string[] };

export type PlanningRules = {
  blockWindow: { start: string; end: string }; // "HH:mm"
  workHours: { start: string; end: string; days: number[] }; // days: 1 = Monday … 7 = Sunday
};

export type RhythmSlot = "rest" | "gym" | "run";
/** ISO weekday (1 = Monday) → planned session. */
export type WeeklyRhythm = Record<1 | 2 | 3 | 4 | 5 | 6 | 7, { slot: RhythmSlot; label: string }>;

export type NotionDataSources = { goals: string; steps: string; books: string; reviews: string };

const DEFAULTS = {
  eventKeywords: {
    run: ["run", "bieg", "biegan", "interval", "interwał", "long run", "run club"],
    training: ["gym", "siłownia", "trening", "training", "workout", "fbw", "full body"],
  } satisfies EventKeywords as EventKeywords,
  planningRules: {
    blockWindow: { start: "08:00", end: "21:00" },
    workHours: { start: "10:00", end: "16:00", days: [1, 2, 3, 4, 5] },
  } satisfies PlanningRules as PlanningRules,
  weeklyRhythm: {
    1: { slot: "rest", label: "Rest" },
    2: { slot: "gym", label: "Gym" },
    3: { slot: "run", label: "Easy run (run club)" },
    4: { slot: "rest", label: "Rest (gym catch-up if Tuesday was missed)" },
    5: { slot: "run", label: "Intervals" },
    6: { slot: "gym", label: "Gym" },
    7: { slot: "run", label: "Long/easy run" },
  } satisfies WeeklyRhythm as WeeklyRhythm,
  /** Exercise titles as Hevy names them; matched case-insensitively by "starts with". */
  keyLifts: ["Squat (Barbell)", "Bench Press (Barbell)", "Deadlift (Barbell)", "Overhead Press (Barbell)"] as string[],
  /** Filled by Notion setup. */
  notionDataSources: null as NotionDataSources | null,
  /** Google calendar id of the "Plan" calendar this app created for approved blocks. */
  planCalendarId: null as string | null,
  /** "I have free time at work today": learning steps may be planned in this window. */
  freeAtWork: null as { date: string; start: string; end: string } | null,
  /** Hevy incremental sync cursor (ISO time of the last successful sync start). */
  hevyCursor: null as string | null,
};

export type SettingKey = keyof typeof DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db().query.setting.findFirst({ where: eq(setting.key, key) });
  return (row?.value as SettingValue<K> | undefined) ?? DEFAULTS[key];
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>) {
  await db().insert(setting).values({ key, value }).onConflictDoUpdate({ target: setting.key, set: { value } });
}
