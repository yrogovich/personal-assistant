import "server-only";
import { toDateKey } from "@/lib/time";
import { aiConfigured } from "../ai/client";
import { generateOnce, hasPlanFor } from "../ai/morning-plan";
import { draftReviewViaApi, hasReviewFor } from "../ai/review";
import { env } from "../env";
import { syncAll } from "./run";

// Every 15 minutes, off the hour (Hevy asks clients not to hit :00).
const SYNC_MINUTES = new Set([7, 22, 37, 52]);

const g = globalThis as unknown as { __paScheduler?: NodeJS.Timeout; __paPlanTried?: string; __paReviewTried?: string };

const PLAN_AT = "06:30";

/** Morning plan at 06:30; if the Mac was asleep, as soon as the server runs again that day. */
async function maybeMorningPlan(now: Date) {
  const tz = env().APP_TIMEZONE;
  const today = toDateKey(now, tz);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(now);
  if (time < PLAN_AT || g.__paPlanTried === today) return;
  g.__paPlanTried = today; // one automatic attempt per day; Replan is always available
  if (!(await aiConfigured()) || (await hasPlanFor(today))) return;
  await syncAll("schedule"); // plan on fresh data
  await generateOnce("schedule").catch((err) =>
    console.error("[plan] morning plan failed:", err instanceof Error ? err.message : err),
  );
}

const REVIEW_AT = "18:00";

/** Sunday from 18:00: draft the weekly review (Claude API only; with Claude Desktop you ask for it). */
async function maybeWeeklyReview(now: Date) {
  const tz = env().APP_TIMEZONE;
  const today = toDateKey(now, tz);
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const time = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  if (weekday !== "Sun" || time < REVIEW_AT || g.__paReviewTried === today) return;
  g.__paReviewTried = today;
  if (!(await aiConfigured()) || (await hasReviewFor("weekly", now))) return;
  await draftReviewViaApi("weekly", null, now).catch((err) =>
    console.error("[review] weekly draft failed:", err instanceof Error ? err.message : err),
  );
}

export function startScheduler() {
  if (g.__paScheduler) return;
  let lastSlot = "";
  g.__paScheduler = setInterval(() => {
    const now = new Date();
    void maybeMorningPlan(now);
    void maybeWeeklyReview(now);
    const slot = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
    if (!SYNC_MINUTES.has(now.getMinutes()) || slot === lastSlot) return;
    lastSlot = slot;
    void syncAll("schedule");
  }, 20_000);
  // Catch up after the Mac wakes or the server restarts.
  setTimeout(() => void syncAll("startup"), 5_000);
}
