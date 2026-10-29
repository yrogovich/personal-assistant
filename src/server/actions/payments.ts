"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { recurringPayment } from "../db/schema";
import { env } from "../env";
import { monthKey } from "../payments";
import type { ActionState } from "./integrations";

const refresh = () => {
  revalidatePath("/today");
  revalidatePath("/month");
  revalidatePath("/settings");
};

const paymentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amount: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Amount must be a number"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  method: z.enum(["auto", "manual"]),
  senderMatch: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null),
});

function parse(form: FormData) {
  return paymentSchema.safeParse({
    name: form.get("name"),
    amount: form.get("amount") ?? "",
    currency: form.get("currency") || "PLN",
    dayOfMonth: form.get("dayOfMonth"),
    method: form.get("method"),
    senderMatch: form.get("senderMatch") ?? "",
  });
}

export async function addPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parse(form);
  if (!parsed.success) return { ok: false, message: "Check the name, amount and day (1–31)." };
  await db().insert(recurringPayment).values(parsed.data);
  refresh();
  return { ok: true, message: "Added" };
}

export async function savePaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const id = Number(form.get("id"));
  const parsed = parse(form);
  if (!parsed.success) return { ok: false, message: "Check the name, amount and day (1–31)." };
  await db().update(recurringPayment).set(parsed.data).where(eq(recurringPayment.id, id));
  refresh();
  return { ok: true, message: "Saved" };
}

export async function deletePaymentAction(id: number): Promise<ActionState> {
  await requireUser();
  await db().delete(recurringPayment).where(eq(recurringPayment.id, id));
  refresh();
  return { ok: true, message: "Removed" };
}

/** Manual payment done for the month it's due in (`dueKey` is YYYY-MM-DD). */
export async function markPaymentDoneAction(id: number, dueKey: string): Promise<ActionState> {
  await requireUser();
  const month = /^\d{4}-\d{2}/.test(dueKey) ? dueKey.slice(0, 7) : monthKey(new Date(), env().APP_TIMEZONE);
  await db().update(recurringPayment).set({ doneMonth: month }).where(eq(recurringPayment.id, id));
  refresh();
  return { ok: true, message: "Done" };
}

/** Hides a failed-payment note. The same mail won't raise it again; a newer failure will. */
export async function clearPaymentProblemAction(id: number): Promise<ActionState> {
  await requireUser();
  await db().update(recurringPayment).set({ problem: null }).where(eq(recurringPayment.id, id));
  refresh();
  return { ok: true, message: "Cleared" };
}
