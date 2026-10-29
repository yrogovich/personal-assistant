import "server-only";
import { eq } from "drizzle-orm";
import { decryptJson, encryptJson } from "../crypto";
import { db } from "../db/client";
import { integration, type Provider } from "../db/schema";

export async function getCredentials<T>(provider: Provider): Promise<T | null> {
  const row = await db().query.integration.findFirst({ where: eq(integration.provider, provider) });
  return row ? decryptJson<T>(row.credentials) : null;
}

export async function saveCredentials(provider: Provider, credentials: unknown, account: string | null) {
  const values = { status: "connected" as const, account, credentials: encryptJson(credentials), lastError: null };
  await db()
    .insert(integration)
    .values({ provider, ...values, connectedAt: new Date() })
    .onConflictDoUpdate({ target: integration.provider, set: values });
}

/** Marks the connection broken (e.g. revoked token). Credentials are kept so a retry can still work. */
export async function markIntegrationError(provider: Provider, message: string) {
  await db().update(integration).set({ status: "error", lastError: message }).where(eq(integration.provider, provider));
}

export async function deleteIntegration(provider: Provider) {
  await db().delete(integration).where(eq(integration.provider, provider));
}

/** Safe for the UI: no credentials. */
export async function listIntegrations() {
  return db()
    .select({
      provider: integration.provider,
      status: integration.status,
      account: integration.account,
      lastError: integration.lastError,
      connectedAt: integration.connectedAt,
    })
    .from(integration);
}

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Google",
  icloud: "iCloud",
  notion: "Notion",
  strava: "Strava",
  hevy: "Hevy",
  anthropic: "Claude API",
  reminders: "Reminders",
};

export class NotConnectedError extends Error {
  constructor(provider: Provider) {
    super(`${PROVIDER_LABEL[provider]} isn't connected. Connect it in Settings.`);
  }
}

/** Thrown when the provider rejected our credentials; the user has to reconnect. */
export class AuthRevokedError extends Error {}
