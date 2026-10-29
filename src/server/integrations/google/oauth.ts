import "server-only";
import { OAuth2Client } from "google-auth-library";
import { env } from "../../env";
import { AuthRevokedError, getCredentials, saveCredentials } from "../store";

// Requested once at connect so later steps don't need a second consent screen.
// calendar.app.created only lets the app manage calendars it creates itself (the "Plan" calendar).
// gmail.modify is used only to add labels and stars (see google/gmail.ts); the app never sends,
// deletes or archives mail.
export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
  GMAIL_MODIFY,
];

type GoogleCredentials = { refreshToken: string; scope: string };

function client(): OAuth2Client {
  const e = env();
  return new OAuth2Client({
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: `${e.BETTER_AUTH_URL}/api/connect/google/callback`,
  });
}

export function googleAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
    login_hint: env().ALLOWED_EMAIL,
  });
}

/** Exchanges the callback code and stores the refresh token. Only the allowed account may connect. */
export async function completeGoogleConnect(code: string): Promise<void> {
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.refresh_token || !tokens.id_token) throw new Error("Google did not return a refresh token");
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: env().GOOGLE_CLIENT_ID });
  const email = ticket.getPayload()?.email?.toLowerCase();
  if (email !== env().ALLOWED_EMAIL) throw new Error(`Connect ${env().ALLOWED_EMAIL}, not ${email ?? "another account"}`);
  const creds: GoogleCredentials = { refreshToken: tokens.refresh_token, scope: tokens.scope ?? "" };
  await saveCredentials("google", creds, email);
}

/** Authorized client, or null when Google isn't connected. */
export async function googleClient(): Promise<OAuth2Client | null> {
  const creds = await getCredentials<GoogleCredentials>("google");
  if (!creds) return null;
  const c = client();
  c.setCredentials({ refresh_token: creds.refreshToken });
  return c;
}

/** Whether the stored Google grant includes a scope (older connections only have gmail.readonly). */
export async function googleHasScope(scope: string): Promise<boolean> {
  const creds = await getCredentials<GoogleCredentials>("google");
  return Boolean(creds?.scope.split(" ").includes(scope));
}

export async function revokeGoogle(): Promise<void> {
  const creds = await getCredentials<GoogleCredentials>("google");
  if (creds) await client().revokeToken(creds.refreshToken).catch(() => undefined);
}

/** Maps Google's "token expired or revoked" to AuthRevokedError so sync marks the integration for reconnect. */
export function rethrowGoogleError(err: unknown): never {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  const message = err instanceof Error ? err.message : String(err);
  if (data?.error === "invalid_grant" || message.includes("invalid_grant")) {
    throw new AuthRevokedError("Google access expired or was revoked. Reconnect Google in Settings.");
  }
  throw err;
}
