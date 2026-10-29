import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db/client";
import { mailThread, MAIL_CATEGORIES, MAIL_LABELS, type MailLabel } from "../db/schema";
import { getSetting, type MailRule } from "../settings";
import { aiConfigured, models, runStructured } from "./client";

export const MAIL_SYSTEM = `You triage a person's unread email for their daily dashboard.
For each thread decide:
- needs_reply: a real person or an important service expects an answer or action from them soon.
- fyi: worth knowing (receipts, confirmations, updates from people or tools they use) but no action.
- ignore: newsletters, promotions, notifications, automated noise.
Write a one-line summary (max 15 words) in plain English. Never invent details beyond the subject and snippet.
Also pick a folder (label), or null if none fits:
- security: sign-in alerts, verification or login codes, password and account security changes.
- money: bills, invoices, receipts, payments, bank and tax mail, failed or declined payments.
- orders: shop orders, shipping and courier updates, deliveries, pickups.
- newsletters: newsletters, marketing, product and app update announcements.
Set star to true only for the few threads that truly matter: a person or an important service waiting on them, a deadline, a failed payment, or a security problem they didn't cause. Most threads are not starred.`;

export const MailOutput = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      category: z.enum(MAIL_CATEGORIES),
      summary: z.string(),
      label: z.enum(MAIL_LABELS).nullable(),
      star: z.boolean(),
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

/** Label and star are optional so older Claude Desktop calls (category + summary only) still work. */
export type MailDecision = Omit<z.infer<typeof MailOutput>["threads"][number], "label" | "star"> & {
  label?: MailLabel | null;
  star?: boolean;
};

/** A sender rule's label beats the model's. */
export async function applyMailCategories(items: MailDecision[]): Promise<number> {
  const now = new Date();
  let n = 0;
  for (const r of items) {
    const res = await db()
      .update(mailThread)
      .set({ category: r.category, summary: r.summary.slice(0, 200), summarizedAt: now, suggestStar: Boolean(r.star) })
      .where(eq(mailThread.id, r.id))
      .returning({ id: mailThread.id });
    if (r.label) {
      await db()
        .update(mailThread)
        .set({ label: r.label, labelSource: "ai" })
        .where(and(eq(mailThread.id, r.id), isNull(mailThread.labelSource)));
    }
    n += res.length;
  }
  return n;
}

export function matchRule(rules: MailRule[], sender: string, subject: string): MailLabel | null {
  const from = sender.toLowerCase();
  const subj = subject.toLowerCase();
  const hit = rules.find(
    (r) => (r.from || r.subject) && from.includes(r.from.toLowerCase()) && (!r.subject || subj.includes(r.subject.toLowerCase())),
  );
  return hit?.label ?? null;
}

/** Labels threads that a fixed sender rule covers. Runs on every sync, with or without AI. */
export async function applyMailRules(): Promise<number> {
  const rules = await getSetting("mailRules");
  const open = await db().query.mailThread.findMany({ where: isNull(mailThread.labelSource) });
  let n = 0;
  for (const t of open) {
    const label = matchRule(rules, t.sender, t.subject);
    if (!label) continue;
    await db().update(mailThread).set({ label, labelSource: "rule" }).where(eq(mailThread.id, t.id));
    n++;
  }
  return n;
}
