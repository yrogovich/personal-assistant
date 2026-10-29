// Local MCP server so Claude Desktop can do the dashboard's AI work on your Claude subscription.
//
// Same rules as the Claude API path:
// - Read tools return the same minimised data the API would get (no event titles of others' meetings,
//   mail as sender name + subject + snippet only, no credentials ever).
// - Write tools only create *proposals* (day blocks, mail categories, step suggestions, review drafts).
//   Nothing reaches Google Calendar or Notion until you approve it in the dashboard. The one direct
//   write is a Gmail folder label (sorting); stars are only suggested.
// - Every write is logged in the AI log (model "claude-desktop").
//
// Run via scripts/mcp-server.sh (stdio). `pnpm mcp:config` prints the Claude Desktop config.

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
// Same files Next.js reads; earlier files win (loadEnvFile never overrides a variable that's already set).
let loaded = 0;
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(root, file));
    loaded++;
  } catch {
    // not present
  }
}
if (!loaded) console.error("[mcp] no .env.local or .env found; see SETUP.md");

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = await import("zod");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { db } = await import("../server/db/client");
const { aiRun, BLOCK_KINDS, MAIL_CATEGORIES, MAIL_LABELS } = await import("../server/db/schema");
const { buildPlanInput, PLAN_SYSTEM, storePlan } = await import("../server/ai/morning-plan");
const { MAIL_SYSTEM, applyMailCategories, unsortedMail } = await import("../server/ai/mail-summary");
const { applyGmailLabels } = await import("../server/integrations/google/gmail");
const { STEPS_GUIDE, stepsContext, storeStepsProposal } = await import("../server/ai/break-steps");
const { REVIEW_GUIDE, reviewContext, upsertReviewDraft } = await import("../server/ai/review");
const { getWeek } = await import("../server/queries/week");
const { getMonth } = await import("../server/queries/month");
const { syncAll } = await import("../server/sync/run");

await migrate(db(), { migrationsFolder: path.join(root, "drizzle") });

const DASHBOARD = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

async function logDesktopRun(job: "morning_plan" | "mail_summary" | "break_steps" | "weekly_review" | "evening_checkin", output: unknown) {
  const [row] = await db()
    .insert(aiRun)
    .values({ job, model: "claude-desktop", input: { via: "Claude Desktop (MCP)" }, output: output as object })
    .returning({ id: aiRun.id });
  return row.id;
}

/**
 * A scheduled Desktop run (e.g. 07:59) may happen while the dashboard server isn't running,
 * so read tools first refresh any feed that hasn't synced in the last 10 minutes.
 */
const STALE_MS = 10 * 60_000;
async function freshen() {
  const feeds = await db().query.feed.findMany();
  const stale = feeds.some((f) => f.enabled && (!f.lastSyncedAt || Date.now() - f.lastSyncedAt.getTime() > STALE_MS));
  if (stale || feeds.length === 0) {
    const results = await syncAll("schedule");
    const failed = results.filter((r) => r.status === "error").map((r) => `${r.feed}: ${r.error}`);
    if (failed.length) console.error("[mcp] sync problems:", failed.join("; "));
    return failed;
  }
  return [];
}

const server = new McpServer({ name: "personal-dashboard", version: "1.0.0" });

// ── Day plan ────────────────────────────────────────────────────────────────

server.registerTool(
  "get_day_context",
  {
    title: "Get today's planning context",
    description:
      "Today's free slots, busy times, rules, weekly progress, open goal steps, due reminders, payments that need attention and mail that needs a reply. Read this before propose_day_plan.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const syncProblems = await freshen();
    const { input } = await buildPlanInput(new Date());
    return json({ instructions: PLAN_SYSTEM, ...input, ...(syncProblems.length ? { sync_problems: syncProblems } : {}) });
  },
);

server.registerTool(
  "propose_day_plan",
  {
    title: "Propose today's plan",
    description:
      "Store a day plan as proposals: a 3–5 line brief, up to 3 top step ids, and time blocks (HH:mm, inside free_slots). Blocks that don't fit free time are dropped. The person approves each block in the dashboard; nothing is added to the calendar here.",
    inputSchema: {
      brief: z.string(),
      top_step_ids: z.array(z.string()),
      blocks: z.array(
        z.object({
          start: z.string().describe('"HH:mm"'),
          end: z.string().describe('"HH:mm"'),
          kind: z.enum(BLOCK_KINDS),
          title: z.string(),
          step_id: z.string().nullable(),
          reason: z.string(),
        }),
      ),
    },
  },
  async (args) => {
    const now = new Date();
    const ctx = await buildPlanInput(now);
    const runId = await logDesktopRun("morning_plan", args);
    const { dropped } = await storePlan(args, "desktop", runId, { now, ...ctx });
    return json({
      stored: args.blocks.length - dropped,
      dropped,
      note: `Proposed. Approve, edit or skip each block at ${DASHBOARD}/today.`,
    });
  },
);

// ── Mail ────────────────────────────────────────────────────────────────────

server.registerTool(
  "get_unsorted_mail",
  {
    title: "Get unsorted mail",
    description: "Unread threads from the last 3 days that have no category yet: sender name/domain, subject, snippet.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    await freshen();
    return json({ instructions: MAIL_SYSTEM, threads: await unsortedMail() });
  },
);

server.registerTool(
  "categorize_mail",
  {
    title: "Categorise mail",
    description:
      "Store per thread id: a category (needs_reply / fyi / ignore), a one-line summary, a folder label (or null) and whether it's worth a star. The label is added in Gmail; a star is only suggested for the person to approve. Never sends, deletes or archives mail.",
    inputSchema: {
      threads: z.array(
        z.object({
          id: z.string(),
          category: z.enum(MAIL_CATEGORIES),
          summary: z.string(),
          label: z.enum(MAIL_LABELS).nullable().optional(),
          star: z.boolean().optional(),
        }),
      ),
    },
  },
  async ({ threads }) => {
    await logDesktopRun("mail_summary", { threads });
    const updated = await applyMailCategories(threads);
    const labelled = await applyGmailLabels().catch((err) => {
      console.error("[mcp] labels:", err instanceof Error ? err.message : err);
      return 0;
    });
    return json({ updated, labelled_in_gmail: labelled, note: `Star suggestions wait for approval at ${DASHBOARD}/today.` });
  },
);

// ── Progress ────────────────────────────────────────────────────────────────

server.registerTool(
  "get_progress",
  {
    title: "Get week and month progress",
    description: "This week's habit rings and risks, steps done/due, and this month's goal progress, runs and books.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const [w, m] = await Promise.all([getWeek(), getMonth()]);
    return json({
      week: {
        rings: w.rings.map((r) => `${r.label}: ${r.done}/${r.target}${r.max ? `-${r.max}` : ""} ${r.unit}`),
        at_risk: w.risks.map((r) => r.message),
        planned_not_confirmed: w.unconfirmed.map((p) => ({ title: p.title, date: p.dateKey })),
        steps_done: w.steps.done.map((s) => s.title),
        steps_due: w.steps.due.filter((s) => s.status !== "done").map((s) => s.title),
      },
      month: {
        goals: m.progress.map((g) => ({ goal: g.title, priority: g.priority, progress: g.pct === null ? null : `${Math.round(g.pct * 100)}%`, detail: g.label })),
        runs: { count: m.runTotals.count, km: Math.round(m.runTotals.km * 10) / 10 },
        books_finished: m.booksFinished.map((b) => b.title),
        latest_weight_kg: m.weights.at(-1)?.kg ?? null,
      },
    });
  },
);

// ── Goals ───────────────────────────────────────────────────────────────────

server.registerTool(
  "get_goal",
  {
    title: "Get a goal and its steps",
    description: "Look up a goal by id or by (part of) its title, with its existing steps. Use before propose_goal_steps.",
    inputSchema: { goal: z.string().describe("Goal id or part of its title") },
    annotations: { readOnlyHint: true },
  },
  async ({ goal: q }) => {
    const goals = await db().query.goal.findMany();
    const match = goals.find((g) => g.id === q) ?? goals.find((g) => g.title.toLowerCase().includes(q.toLowerCase()));
    if (!match) return json({ error: "No such goal", goals: goals.map((g) => ({ id: g.id, title: g.title })) });
    return json({ instructions: STEPS_GUIDE, ...(await stepsContext(match.id)) });
  },
);

server.registerTool(
  "propose_goal_steps",
  {
    title: "Propose steps for a goal",
    description: "Store suggested steps for a goal. The person picks which to add to Notion on the Goals screen.",
    inputSchema: {
      goal_id: z.string(),
      steps: z.array(z.object({ title: z.string(), estimate_min: z.number() })),
    },
  },
  async ({ goal_id, steps }) => {
    await stepsContext(goal_id); // throws for an unknown goal
    const runId = await logDesktopRun("break_steps", { goal_id, steps });
    await storeStepsProposal(goal_id, steps, "desktop", runId);
    return json({ note: `Proposed ${steps.length} step(s). Review them at ${DASHBOARD}/goals.` });
  },
);

// ── Reviews ─────────────────────────────────────────────────────────────────

const ReviewType = z.enum(["daily", "weekly"]);

server.registerTool(
  "get_review_context",
  {
    title: "Get review facts",
    description: "Facts for the evening check-in (daily) or the weekly review (weekly). Ask the person for anything the facts miss.",
    inputSchema: { type: ReviewType },
    annotations: { readOnlyHint: true },
  },
  async ({ type }) => json({ instructions: REVIEW_GUIDE[type], ...(await reviewContext(type)) }),
);

server.registerTool(
  "save_review_draft",
  {
    title: "Save a review draft",
    description: "Store a markdown draft. The person edits and confirms it in the dashboard; only then is it saved to Notion.",
    inputSchema: { type: ReviewType, markdown: z.string() },
  },
  async ({ type, markdown }) => {
    const runId = await logDesktopRun(type === "daily" ? "evening_checkin" : "weekly_review", { type, markdown });
    await upsertReviewDraft(type, new Date(), { draft: markdown, source: "desktop", aiRunId: runId });
    return json({ note: `Draft saved. Edit and confirm it at ${DASHBOARD}/review.` });
  },
);

// ── Prompts (pick them from Claude Desktop's "+" menu) ─────────────────────

const prompt = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

server.registerPrompt("plan_my_day", { title: "Plan my day" }, () =>
  prompt(
    "Plan my day with the personal-dashboard tools: first triage any unsorted mail (get_unsorted_mail → categorize_mail), then read get_day_context and call propose_day_plan following its instructions. Then show me the brief and the blocks.",
  ),
);
server.registerPrompt("triage_mail", { title: "Triage my mail" }, () =>
  prompt("Use get_unsorted_mail, then categorize_mail following its instructions. Then list what needs a reply."),
);
server.registerPrompt("evening_checkin", { title: "Draft my evening check-in" }, () =>
  prompt("Use get_review_context with type daily, ask me one short question if something is unclear, then save_review_draft."),
);
server.registerPrompt("weekly_review", { title: "Draft my weekly review" }, () =>
  prompt("Use get_review_context with type weekly and get_progress, then save_review_draft with type weekly following the instructions."),
);
server.registerPrompt(
  "break_goal_into_steps",
  { title: "Break a goal into steps", argsSchema: { goal: z.string().describe("Goal title") } },
  ({ goal }) => prompt(`Use get_goal for "${goal}", then propose_goal_steps following its instructions.`),
);

await server.connect(new StdioServerTransport());
console.error("[mcp] personal-dashboard ready");
