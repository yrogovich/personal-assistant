import "server-only";
import { addDays } from "date-fns";
import { ImapFlow, type MessageStructureObject } from "imapflow";
import { MAIL_WINDOW_DAYS, storeThreads, type FetchedThread } from "../mail-store";
import { AuthRevokedError, getCredentials, NotConnectedError } from "../store";
import type { IcloudCredentials } from "./caldav";

// Read-only: INBOX is opened read-only, so nothing is marked as read. Only unread messages
// from the last few days; sender, subject and the first ~1 KB of the plain-text part as a snippet.

const MAX_MESSAGES = 30;
const SNIPPET_BYTES = 1024;

function findTextPart(node: MessageStructureObject | undefined): string | null {
  if (!node) return null;
  if (node.type === "text/plain" && node.disposition !== "attachment") return node.part ?? "1";
  for (const child of node.childNodes ?? []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  return null;
}

async function readSnippet(client: ImapFlow, uid: number, part: string): Promise<string> {
  const dl = await client.download(String(uid), part, { uid: true, maxBytes: SNIPPET_BYTES });
  if (!("content" in dl) || !dl.content) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of dl.content) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function syncIcloudMail(): Promise<number> {
  const creds = await getCredentials<IcloudCredentials>("icloud");
  if (!creds) throw new NotConnectedError("icloud");

  const client = new ImapFlow({
    host: "imap.mail.me.com",
    port: 993,
    secure: true,
    auth: { user: creds.appleId, pass: creds.appPassword },
    logger: false,
  });
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean };
    if (e.authenticationFailed) throw new AuthRevokedError("iCloud Mail rejected the Apple ID or app-specific password.");
    throw err;
  }

  const threads: FetchedThread[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = await client.search({ seen: false, since: addDays(new Date(), -MAIL_WINDOW_DAYS) }, { uid: true });
      const recent = (uids || []).slice(-MAX_MESSAGES);
      if (recent.length) {
        const messages = await client.fetchAll(
          recent.join(","),
          { uid: true, envelope: true, bodyStructure: true, internalDate: true },
          { uid: true },
        );
        for (const m of messages) {
          const from = m.envelope?.from?.[0];
          const part = findTextPart(m.bodyStructure);
          const snippet = part ? await readSnippet(client, m.uid, part).catch(() => "") : "";
          threads.push({
            threadId: m.envelope?.messageId ?? `uid-${m.uid}`,
            sender: from ? (from.name ? `${from.name} <${from.address}>` : (from.address ?? "")) : "",
            subject: m.envelope?.subject ?? "",
            snippet,
            receivedAt: m.internalDate ? new Date(m.internalDate) : new Date(),
            unread: true,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return storeThreads("icloud_mail", threads);
}
