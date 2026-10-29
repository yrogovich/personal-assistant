import "server-only";
import { addDays } from "date-fns";
import { asc, eq } from "drizzle-orm";
import { dateOnlyInTz, toDateKey } from "@/lib/time";
import { db } from "./db/client";
import { recurringPayment } from "./db/schema";
import { env } from "./env";
import { getSetting, setSetting } from "./settings";

// Monthly payments, kept quiet on purpose: Today only shows a manual payment in the few days
// before it's due (until you mark it done) and an automatic one whose payment mail says it failed.

/** How many days ahead a manual payment starts showing on Today. */
export const DUE_SOON_DAYS = 3;

const FAILED = /nie powiod|nieudan|odrzucon|failed|declined|unsuccessful|update your payment/i;

// Found in Gmail on 2026-10-29. Amounts weren't in the subjects, so they start empty.
const STARTER: (typeof recurringPayment.$inferInsert)[] = [
  { name: "inFakt (accounting)", dayOfMonth: 8, method: "auto", senderMatch: "infakt.pl" },
  { name: "Vectra (internet)", dayOfMonth: 9, method: "auto", senderMatch: "vectra" },
  { name: "Claude Pro", dayOfMonth: 23, method: "auto", senderMatch: "anthropic" },
  { name: "Send invoice to Adchitects", dayOfMonth: 3, method: "manual" },
  { name: "ZUS contributions", dayOfMonth: 20, method: "manual" },
  { name: "VAT", dayOfMonth: 25, method: "manual" },
  { name: "MultiSport", dayOfMonth: 10, method: "manual" },
];

/** Adds the starter list once. Deleting them all later doesn't bring them back. */
export async function seedPayments() {
  if (await getSetting("paymentsSeeded")) return;
  const existing = await db().query.recurringPayment.findFirst();
  if (!existing) await db().insert(recurringPayment).values(STARTER);
  await setSetting("paymentsSeeded", true);
}

export const monthKey = (date: Date, tz: string) => toDateKey(date, tz).slice(0, 7);

/** This month's due date for a day-of-month, clamped (31 → 30 Nov). */
export function dueDateIn(year: number, month1: number, day: number, tz: string): Date {
  const last = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return dateOnlyInTz(year, month1, Math.min(day, last), tz);
}

export async function listPayments() {
  await seedPayments();
  return db().query.recurringPayment.findMany({ orderBy: asc(recurringPayment.dayOfMonth) });
}

export type PaymentAlert = {
  id: number;
  name: string;
  kind: "due" | "overdue" | "failed";
  dueKey?: string; // YYYY-MM-DD
  amount: number | null;
  currency: string;
  problem?: string;
};

/** What Today shows: failed automatic payments, and manual ones due within a few days or overdue this month. */
export async function getPaymentAlerts(now = new Date()): Promise<PaymentAlert[]> {
  const tz = env().APP_TIMEZONE;
  const todayKey = toDateKey(now, tz);
  const [y, m] = todayKey.split("-").map(Number);
  const soonKey = toDateKey(addDays(now, DUE_SOON_DAYS), tz);
  const thisMonth = monthKey(now, tz);
  const payments = await listPayments();
  const alerts: PaymentAlert[] = [];
  for (const p of payments) {
    if (p.method === "auto") {
      if (p.problem) alerts.push({ id: p.id, name: p.name, kind: "failed", amount: p.amount, currency: p.currency, problem: p.problem });
      continue;
    }
    if (p.doneMonth === thisMonth) continue;
    const dueKey = toDateKey(dueDateIn(y, m, p.dayOfMonth, tz), tz);
    // A payment added after its day this month starts counting next month, not as overdue.
    if (dueKey < toDateKey(p.createdAt, tz)) continue;
    if (dueKey < todayKey) alerts.push({ id: p.id, name: p.name, kind: "overdue", dueKey, amount: p.amount, currency: p.currency });
    else if (dueKey <= soonKey) alerts.push({ id: p.id, name: p.name, kind: "due", dueKey, amount: p.amount, currency: p.currency });
  }
  // Next month's early payments (e.g. on the 1st) when today is near the end of the month.
  const next = new Date(Date.UTC(y, m, 1));
  const [ny, nm] = [next.getUTCFullYear(), next.getUTCMonth() + 1];
  const nextMonth = `${ny}-${String(nm).padStart(2, "0")}`;
  for (const p of payments) {
    if (p.method !== "manual" || p.doneMonth === nextMonth) continue;
    const dueKey = toDateKey(dueDateIn(ny, nm, p.dayOfMonth, tz), tz);
    if (dueKey <= soonKey) alerts.push({ id: p.id, name: p.name, kind: "due", dueKey, amount: p.amount, currency: p.currency });
  }
  const order = { failed: 0, overdue: 1, due: 2 };
  return alerts.sort((a, b) => order[a.kind] - order[b.kind] || (a.dueKey ?? "").localeCompare(b.dueKey ?? ""));
}

/** One line for Month: how many payments, the known monthly total, and how many still lack an amount. */
export async function getPaymentSummary() {
  const payments = await listPayments();
  const known = payments.filter((p) => p.amount !== null);
  const totals = new Map<string, number>();
  for (const p of known) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount!);
  return {
    payments,
    count: payments.length,
    totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
    missingAmounts: payments.length - known.length,
    problems: payments.filter((p) => p.problem).length,
  };
}

/**
 * After a mail sync: an automatic payment whose mail (sender or subject contains its match text)
 * says it failed gets a problem note, shown on Today until you clear it.
 */
export async function detectPaymentProblems(): Promise<number> {
  const payments = (await listPayments()).filter((p) => p.method === "auto" && p.senderMatch);
  if (payments.length === 0) return 0;
  const threads = await db().query.mailThread.findMany();
  let n = 0;
  for (const p of payments) {
    const match = p.senderMatch!.toLowerCase();
    const failed = threads
      .filter((t) => `${t.sender} ${t.subject}`.toLowerCase().includes(match) && FAILED.test(`${t.subject} ${t.snippet}`))
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];
    if (!failed || (p.problemAt && p.problemAt >= failed.receivedAt)) continue;
    await db()
      .update(recurringPayment)
      .set({ problem: failed.subject.slice(0, 200), problemAt: failed.receivedAt })
      .where(eq(recurringPayment.id, p.id));
    n++;
  }
  return n;
}
