"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db } from "../db/client";
import { aiDecision, mailThread } from "../db/schema";
import { starGmailThread } from "../integrations/google/gmail";
import type { ActionState } from "./integrations";

/** The AI only suggests a star; this is you pressing Star. */
export async function starThreadAction(id: string): Promise<ActionState> {
  await requireUser();
  const t = await db().query.mailThread.findFirst({ where: eq(mailThread.id, id) });
  if (!t || t.source !== "gmail") return { ok: false, message: "Only Gmail threads can be starred." };
  try {
    await starGmailThread(t.threadId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't star it" };
  }
  await db().update(mailThread).set({ starDecision: "starred" }).where(eq(mailThread.id, id));
  await db().insert(aiDecision).values({ item: `star:${id}`, decision: "approved", before: { subject: t.subject } });
  revalidatePath("/today");
  return { ok: true, message: "Starred in Gmail" };
}

export async function dismissStarAction(id: string): Promise<ActionState> {
  await requireUser();
  const t = await db().query.mailThread.findFirst({ where: eq(mailThread.id, id) });
  if (!t) return { ok: false, message: "Thread not found" };
  await db().update(mailThread).set({ starDecision: "dismissed" }).where(eq(mailThread.id, id));
  await db().insert(aiDecision).values({ item: `star:${id}`, decision: "skipped", before: { subject: t.subject } });
  revalidatePath("/today");
  return { ok: true, message: "Not starred" };
}
