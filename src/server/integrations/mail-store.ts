import "server-only";
import { and, eq, lt, notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { mailThread } from "../db/schema";

export type FetchedThread = {
  threadId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  unread: boolean;
};

export const MAIL_WINDOW_DAYS = 3;
const SNIPPET_MAX = 300;

/**
 * Replaces one source's cached threads with what's currently unread/recent.
 * Keeps the AI category and label for threads we've already summarised, so they aren't sent again.
 */
export async function storeThreads(source: "gmail" | "icloud_mail", threads: FetchedThread[]): Promise<number> {
  const ids = threads.map((t) => `${source}:${t.threadId}`);
  await db().transaction(async (tx) => {
    await tx
      .delete(mailThread)
      .where(ids.length ? and(eq(mailThread.source, source), notInArray(mailThread.id, ids)) : eq(mailThread.source, source));
    for (const t of threads) {
      const row = {
        id: `${source}:${t.threadId}`,
        source,
        threadId: t.threadId,
        sender: t.sender.slice(0, 200),
        subject: (t.subject || "(no subject)").slice(0, 300),
        snippet: t.snippet.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX),
        receivedAt: t.receivedAt,
        unread: t.unread,
      };
      // A newer message in the thread resets the summary.
      const existing = await tx.query.mailThread.findFirst({ where: eq(mailThread.id, row.id) });
      const changed = !existing || existing.receivedAt.getTime() !== row.receivedAt.getTime();
      await tx
        .insert(mailThread)
        .values(row)
        .onConflictDoUpdate({
          target: mailThread.id,
          set: changed
            ? { ...row, category: null, summary: null, summarizedAt: null, label: null, labelSource: null, labeledAt: null, suggestStar: false }
            : { unread: row.unread },
        });
    }
  });
  return threads.length;
}

export async function clearThreads(source: "gmail" | "icloud_mail") {
  await db().delete(mailThread).where(eq(mailThread.source, source));
}

export async function pruneOldThreads(before: Date) {
  await db().delete(mailThread).where(lt(mailThread.receivedAt, before));
}
