import "server-only";
import { gmail as googleGmail } from "@googleapis/gmail";
import { MAIL_WINDOW_DAYS, storeThreads, type FetchedThread } from "../mail-store";
import { NotConnectedError } from "../store";
import { googleClient, rethrowGoogleError } from "./oauth";

// Read-only (gmail.readonly). Only unread inbox threads from the last few days, and only
// sender + subject + Gmail's snippet. Message bodies are never fetched. Never sends mail.

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

export const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
