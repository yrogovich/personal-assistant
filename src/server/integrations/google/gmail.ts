import "server-only";
import { gmail as googleGmail } from "@googleapis/gmail";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { mailThread, type MailLabel } from "../../db/schema";
import { getSetting } from "../../settings";
import { MAIL_WINDOW_DAYS, storeThreads, type FetchedThread } from "../mail-store";
import { NotConnectedError } from "../store";
import { GMAIL_MODIFY, googleClient, googleHasScope, rethrowGoogleError } from "./oauth";

// Reads only unread inbox threads from the last few days, and only sender + subject + Gmail's
// snippet. Message bodies are never fetched. The only writes are adding a label (sorting) and a
// star you approved. Never sends, deletes, archives or marks mail as read.

const MAX_THREADS = 30;

export async function syncGmail(): Promise<number> {
  const auth = await googleClient();
  if (!auth) throw new NotConnectedError("google");
  const api = googleGmail({ version: "v1", auth });
  try {
    const list = await api.users.threads.list({
      userId: "me",
      q: `in:inbox is:unread newer_than:${MAIL_WINDOW_DAYS}d`,
      maxResults: MAX_THREADS,
    });
    const threads: FetchedThread[] = [];
    for (const t of list.data.threads ?? []) {
      if (!t.id) continue;
      const full = await api.users.threads.get({
        userId: "me",
        id: t.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });
      const messages = full.data.messages ?? [];
      const last = messages.at(-1);
      if (!last) continue;
      const header = (name: string) => last.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
      threads.push({
        threadId: t.id,
        sender: header("from"),
        subject: header("subject") || messages[0]?.payload?.headers?.find((h) => h.name === "Subject")?.value || "",
        snippet: decodeEntities(last.snippet ?? t.snippet ?? ""),
        receivedAt: new Date(Number(last.internalDate ?? Date.now())),
        unread: messages.some((m) => m.labelIds?.includes("UNREAD")),
      });
    }
    return storeThreads("gmail", threads);
  } catch (err) {
    rethrowGoogleError(err);
  }
}

/** Gmail snippets are HTML-escaped. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** False until Google is reconnected with gmail.modify (connections made before sorting existed). */
export const canSortGmail = () => googleHasScope(GMAIL_MODIFY);

async function gmailApi() {
  const auth = await googleClient();
  if (!auth) throw new NotConnectedError("google");
  return googleGmail({ version: "v1", auth });
}

/** Gmail label ids by sorting folder; creates a label that doesn't exist yet. */
async function labelIds(api: Awaited<ReturnType<typeof gmailApi>>): Promise<Record<MailLabel, string>> {
  const names = await getSetting("mailLabels");
  const existing = (await api.users.labels.list({ userId: "me" })).data.labels ?? [];
  const out = {} as Record<MailLabel, string>;
  for (const [key, name] of Object.entries(names) as [MailLabel, string][]) {
    let id = existing.find((l) => l.name?.toLowerCase() === name.toLowerCase())?.id;
    if (!id) {
      const created = await api.users.labels.create({
        userId: "me",
        requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      id = created.data.id!;
    }
    out[key] = id;
  }
  return out;
}

/** Adds the decided label in Gmail to threads that don't have it yet. Leaves them in the inbox. */
export async function applyGmailLabels(): Promise<number> {
  if (!(await canSortGmail())) return 0;
  const pending = await db().query.mailThread.findMany({
    where: and(eq(mailThread.source, "gmail"), isNotNull(mailThread.label), isNull(mailThread.labeledAt)),
  });
  if (pending.length === 0) return 0;
  const api = await gmailApi();
  try {
    const ids = await labelIds(api);
    for (const t of pending) {
      await api.users.threads.modify({ userId: "me", id: t.threadId, requestBody: { addLabelIds: [ids[t.label!]] } });
      await db().update(mailThread).set({ labeledAt: new Date() }).where(eq(mailThread.id, t.id));
    }
    return pending.length;
  } catch (err) {
    rethrowGoogleError(err);
  }
}

/** Stars a thread in Gmail. Only called when you press Star on the Today screen. */
export async function starGmailThread(threadId: string): Promise<void> {
  if (!(await canSortGmail())) throw new Error("Reconnect Google in Settings to allow starring.");
  const api = await gmailApi();
  try {
    await api.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: ["STARRED"] } });
  } catch (err) {
    rethrowGoogleError(err);
  }
}

export const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
