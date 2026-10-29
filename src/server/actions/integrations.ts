"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { db } from "../db/client";
import {
  activity,
  book,
  calendar,
  feed,
  FEEDS,
  goal,
  PROVIDERS,
  step,
  weightLog,
  workout,
  type Provider,
} from "../db/schema";
import { clearEvents, deleteCalendarsOf } from "../integrations/calendar-store";
import { revokeGoogle } from "../integrations/google/oauth";
import { testHevyKey } from "../integrations/hevy";
import { testIcloudCalendar, type IcloudCredentials } from "../integrations/icloud/caldav";
import { notionClient } from "../integrations/notion/client";
import { seedNotion, setupNotionDatabases } from "../integrations/notion/setup";
import { revokeStrava } from "../integrations/strava";
import { clearThreads } from "../integrations/mail-store";
import { clearReminders, testReminders } from "../integrations/reminders";
import { testAnthropicKey } from "../ai/client";
import { deleteIntegration, saveCredentials } from "../integrations/store";
import { setSetting } from "../settings";
import { FEED_PROVIDER, syncAll, syncFeed, syncProvider } from "../sync/run";

export type ActionState = { ok: boolean; message: string } | null;

const refresh = () => {
  revalidatePath("/today");
  revalidatePath("/settings");
};

export async function syncNowAction(): Promise<ActionState> {
  await requireUser();
  const results = await syncAll("manual");
  refresh();
  const failed = results.filter((r) => r.status === "error");
  return failed.length
    ? { ok: false, message: failed.map((f) => `${f.feed}: ${f.error}`).join("\n") }
    : { ok: true, message: "Synced" };
}

const icloudSchema = z.object({
  appleId: z.email("Enter your Apple ID email"),
  appPassword: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i, "App-specific passwords look like abcd-efgh-ijkl-mnop")),
});

export async function connectIcloudAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = icloudSchema.safeParse({ appleId: form.get("appleId"), appPassword: form.get("appPassword") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const creds: IcloudCredentials = parsed.data;
  try {
    await testIcloudCalendar(creds);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not reach iCloud" };
  }
  await saveCredentials("icloud", creds, creds.appleId);
  await syncProvider("icloud", "connect");
  refresh();
  return { ok: true, message: "iCloud connected" };
}

/** Removes credentials and everything cached from that provider. */
export async function disconnectAction(provider: Provider): Promise<void> {
  await requireUser();
  if (!PROVIDERS.includes(provider)) return;
  if (provider === "google") await revokeGoogle();
  if (provider === "strava") await revokeStrava();
  if (provider === "google" || provider === "icloud") await deleteCalendarsOf(provider);
  if (provider === "notion") {
    // The databases stay in Notion; reconnecting finds and reuses them.
    for (const t of [step, goal, book]) await db().delete(t);
    await setSetting("notionDataSources", null);
  }
  if (provider === "strava") await db().delete(activity);
  if (provider === "google") await clearThreads("gmail");
  if (provider === "icloud") await clearThreads("icloud_mail");
  if (provider === "reminders") await clearReminders();
  if (provider === "hevy") {
    await db().delete(workout);
    await db().delete(weightLog).where(eq(weightLog.source, "hevy"));
    await setSetting("hevyCursor", null);
  }
  await deleteIntegration(provider);
  for (const key of FEEDS) {
    if (FEED_PROVIDER[key] === provider) {
      await db().update(feed).set({ lastSyncedAt: null, lastError: null }).where(eq(feed.key, key));
    }
  }
  refresh();
}

export async function setFeedEnabledAction(key: (typeof FEEDS)[number], enabled: boolean): Promise<void> {
  await requireUser();
  if (!FEEDS.includes(key)) return;
  await db().insert(feed).values({ key, enabled }).onConflictDoUpdate({ target: feed.key, set: { enabled } });
  if (enabled) await syncFeed(key, "manual");
  refresh();
}

export async function setCalendarIncludedAction(id: string, included: boolean): Promise<void> {
  await requireUser();
  const [cal] = await db().update(calendar).set({ included }).where(eq(calendar.id, id)).returning();
  if (!cal) return;
  if (!included) await clearEvents(id);
  else await syncFeed(cal.source === "google" ? "google_calendar" : "icloud_calendar", "manual");
  refresh();
}

export async function setCalendarRoleAction(id: string, role: "normal" | "training"): Promise<void> {
  await requireUser();
  await db().update(calendar).set({ role }).where(eq(calendar.id, id));
  const cal = await db().query.calendar.findFirst({ where: eq(calendar.id, id) });
  if (cal) await syncFeed(cal.source === "google" ? "google_calendar" : "icloud_calendar", "manual");
  refresh();
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function saveKeywordsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  await setSetting("eventKeywords", { run: list(form.get("run")), training: list(form.get("training")) });
  await syncAll("manual"); // re-classify cached events
  refresh();
  return { ok: true, message: "Keywords saved" };
}

const notionSchema = z.object({
  token: z.string().trim().regex(/^(ntn_|secret_)\S+$/, "Paste the Internal Integration Secret (starts with ntn_)"),
  page: z.string().trim().min(1, "Paste the link to your Dashboard page"),
});

/** Connects Notion, creates (or finds) the four databases, seeds goals once, then syncs. */
export async function connectNotionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = notionSchema.safeParse({ token: form.get("token"), page: form.get("page") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { extractNotionId, Client } = await import("@notionhq/client");
  const parentPageId = extractNotionId(parsed.data.page);
  if (!parentPageId) return { ok: false, message: "That doesn't look like a Notion page link." };
  try {
    const page = await new Client({ auth: parsed.data.token }).pages.retrieve({ page_id: parentPageId });
    const title = "properties" in page ? Object.values(page.properties).find((p) => p.type === "title") : undefined;
    const name = title?.type === "title" ? title.title.map((t) => t.plain_text).join("") : "Dashboard";
    await saveCredentials("notion", { token: parsed.data.token, parentPageId }, name || "Dashboard");
  } catch {
    return { ok: false, message: "Notion can't open that page. Check the secret and share the page with the integration." };
  }
  return finishNotionSetup();
}

export async function retryNotionSetupAction(): Promise<ActionState> {
  await requireUser();
  await notionClient(); // throws if not connected
  return finishNotionSetup();
}

async function finishNotionSetup(): Promise<ActionState> {
  try {
    const ids = await setupNotionDatabases();
    const seeded = await seedNotion(ids);
    await syncFeed("notion", "connect");
    refresh();
    return {
      ok: true,
      message: seeded.goals ? `Created databases and added ${seeded.goals} goals with ${seeded.steps} steps` : "Notion connected",
    };
  } catch (err) {
    refresh();
    return { ok: false, message: err instanceof Error ? err.message : "Notion setup failed" };
  }
}

export async function connectHevyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const key = z.uuid("Hevy API keys look like 8-4-4-4-12 hex characters").safeParse(String(form.get("apiKey") ?? "").trim());
  if (!key.success) return { ok: false, message: key.error.issues[0].message };
  let user: string;
  try {
    user = await testHevyKey(key.data);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Hevy rejected the key" };
  }
  await saveCredentials("hevy", { apiKey: key.data }, user);
  await syncProvider("hevy", "connect");
  refresh();
  return { ok: true, message: "Hevy connected" };
}

export async function connectAnthropicAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const key = String(form.get("apiKey") ?? "").trim();
  if (!key.startsWith("sk-ant-")) return { ok: false, message: "Claude API keys start with sk-ant-" };
  try {
    await testAnthropicKey(key);
  } catch {
    return { ok: false, message: "The Claude API rejected that key." };
  }
  await saveCredentials("anthropic", { apiKey: key }, `…${key.slice(-4)}`);
  refresh();
  return { ok: true, message: "Claude API connected" };
}

/** Reminders needs no credentials: connecting just checks macOS lets us read them. */
export async function connectRemindersAction(): Promise<ActionState> {
  await requireUser();
  let count: number;
  try {
    count = await testReminders();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't read Reminders" };
  }
  await saveCredentials("reminders", {}, `${count} open reminders`);
  await syncFeed("reminders", "connect");
  refresh();
  return { ok: true, message: "Reminders connected" };
}
