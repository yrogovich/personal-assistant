import "server-only";
import { inArray, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db/client";
import { mailThread, MAIL_CATEGORIES } from "../db/schema";
import { aiConfigured, models, runStructured } from "./client";

export const MAIL_SYSTEM = `You triage a person's unread email for their daily dashboard.
For each thread decide:
- needs_reply: a real person or an important service expects an answer or action from them soon.
- fyi: worth knowing (receipts, confirmations, updates from people or tools they use) but no action.
- ignore: newsletters, promotions, notifications, automated noise.
Write a one-line summary (max 15 words) in plain English. Never invent details beyond the subject and snippet.`;

export const MailOutput = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      category: z.enum(MAIL_CATEGORIES),
      summary: z.string(),
    }),
  ),
});

/** "Jane Doe <jane@acme.com>" → "Jane Doe (acme.com)": enough to judge, no full address sent. */
export function minimalSender(from: string): string {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<[^@>]+@([^>]+)>/);
  if (m) return `${m[1].trim() || "unknown"} (${m[2]})`;
  const domain = from.split("@")[1];
  return domain ? `(${domain.replace(/>.*/, "")})` : from;
}

/** Categorises threads that have no category yet. Silently does nothing without an API key. */
export async function summarizeNewMail(): Promise<number> {
  if (!(await aiConfigured())) return 0;
  const pending = await db().query.mailThread.findMany({ where: isNull(mailThread.category), limit: 40 });
  if (pending.length === 0) return 0;

  const { output } = await runStructured({
    job: "mail_summary",
    model: models().fast,
    system: MAIL_SYSTEM,
    effort: "low",
    maxTokens: 8000,
    input: {
      threads: pending.map((t) => ({ id: t.id, from: minimalSender(t.sender), subject: t.subject, snippet: t.snippet })),
    },
    schema: MailOutput,
  });

  return applyMailCategories(output.threads);
}

/** Threads the model hasn't seen yet, minimised (shared with the Claude Desktop path). */
export async function unsortedMail() {
  const pending = await db().query.mailThread.findMany({ where: isNull(mailThread.category), limit: 40 });
  return pending.map((t) => ({ id: t.id, from: minimalSender(t.sender), subject: t.subject, snippet: t.snippet }));
}

export async function applyMailCategories(items: z.infer<typeof MailOutput>["threads"]): Promise<number> {
  const now = new Date();
  let n = 0;
  for (const r of items) {
    const res = await db()
      .update(mailThread)
      .set({ category: r.category, summary: r.summary.slice(0, 200), summarizedAt: now })
      .where(inArray(mailThread.id, [r.id]))
      .returning({ id: mailThread.id });
    n += res.length;
  }
  return n;
}
