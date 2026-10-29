import "server-only";
import { z } from "zod";

const schema = z.object({
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  ALLOWED_EMAIL: z.email().transform((v) => v.toLowerCase()),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY must be 32 bytes, base64"),
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  // Model ids are config: the planner/reviews use the capable model, mail triage the fast one.
  AI_PLAN_MODEL: z.string().default("claude-opus-5-5"),
  AI_FAST_MODEL: z.string().default("claude-haiku-5-5"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  APP_TIMEZONE: z.string().default("Europe/Warsaw"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated env. Parsed lazily so `next build` works without secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment. See SETUP.md.\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
