import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq } from "drizzle-orm";
import type { z } from "zod/v4";
import { db } from "../db/client";
import { aiRun, type AI_JOBS } from "../db/schema";
import { env } from "../env";
import { getCredentials, NotConnectedError } from "../integrations/store";

// Server-side only. The key comes from Settings (encrypted) or ANTHROPIC_API_KEY.

export type AnthropicCredentials = { apiKey: string };

export function models() {
  const e = env();
  return { plan: e.AI_PLAN_MODEL, fast: e.AI_FAST_MODEL };
}

async function client(): Promise<Anthropic> {
  const creds = await getCredentials<AnthropicCredentials>("anthropic");
  const apiKey = creds?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new NotConnectedError("anthropic");
  return new Anthropic({ apiKey });
}

export async function aiConfigured(): Promise<boolean> {
  return Boolean((await getCredentials<AnthropicCredentials>("anthropic")) ?? process.env.ANTHROPIC_API_KEY);
}

/** Throws if the key doesn't work. */
export async function testAnthropicKey(apiKey: string): Promise<void> {
  await new Anthropic({ apiKey }).models.retrieve(models().fast);
}

// Server-side refusal fallback ("default" routes by refusal category) for the models that support it.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export class AiRefusalError extends Error {}

/**
 * One structured call. The input object is what we send (already minimised) and is logged
 * as-is in ai_run together with the parsed output, so every suggestion can be inspected later.
 */
export async function runStructured<S extends z.ZodType>(opts: {
  job: (typeof AI_JOBS)[number];
  model: string;
  system: string;
  input: unknown;
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<{ runId: number; output: z.infer<S> }> {
  const [run] = await db()
    .insert(aiRun)
    .values({ job: opts.job, model: opts.model, input: opts.input as object })
    .returning({ id: aiRun.id });

  try {
    const anthropic = await client();
    const withFallback = FALLBACK_MODELS.has(opts.model);
    const response = await anthropic.beta.messages.parse({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: JSON.stringify(opts.input) }],
      output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") throw new AiRefusalError("The model declined this request.");
    if (response.stop_reason === "max_tokens") throw new Error("The model ran out of output tokens.");
    const output = response.parsed_output;
    if (!output) throw new Error("The model returned output that didn't match the schema.");
    await db()
      .update(aiRun)
      .set({
        output: output as object,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      })
      .where(eq(aiRun.id, run.id));
    return { runId: run.id, output };
  } catch (err) {
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "Claude API key rejected. Update it in Settings."
        : err instanceof Anthropic.RateLimitError
          ? "Claude API rate limit reached. Try again in a minute."
          : err instanceof Error
            ? err.message
            : String(err);
    await db().update(aiRun).set({ error: message }).where(eq(aiRun.id, run.id));
    throw new Error(message);
  }
}
