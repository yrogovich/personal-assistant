import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "./db/client";
import { authAccount, authSession, authUser, authVerification } from "./db/schema";
import { env } from "./env";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === env().ALLOWED_EMAIL;
}

// Sign-in only proves who you are (openid email profile). Calendar and Gmail access
// is granted separately on the Settings page, so it can be disconnected on its own.
function create() {
  const e = env();
  return betterAuth({
    appName: "Dashboard",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "sqlite",
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    socialProviders: {
      google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, prompt: "select_account" },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { encryptOAuthTokens: true },
    telemetry: { enabled: false },
    databaseHooks: {
      // Single user: only the allowed, verified Google account can ever be created…
      user: {
        create: { before: async (user) => isAllowedEmail(user.email) && user.emailVerified },
      },
      // …and only that account can get a session.
      session: {
        create: {
          before: async (session) => {
            const u = await db().query.authUser.findFirst({ where: eq(authUser.id, session.userId) });
            return isAllowedEmail(u?.email);
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof create>;

// Built on first use so `next build` doesn't need secrets.
const g = globalThis as unknown as { __paAuth?: Auth };

export function auth(): Auth {
  g.__paAuth ??= create();
  return g.__paAuth;
}

/** Data-access guard: call at the top of every page, server action and route handler. */
export async function requireUser(): Promise<{ email: string; name: string | null }> {
  await connection(); // per-request: never prerender a page behind login
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session || !isAllowedEmail(session.user.email)) redirect("/login");
  return { email: session.user.email, name: session.user.name || null };
}
