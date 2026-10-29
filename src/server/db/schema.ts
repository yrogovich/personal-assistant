import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Portable on purpose: text ids, ms timestamps, JSON as text. No SQLite-only features.

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = (name = "created_at") => timestamp(name).notNull().$defaultFn(() => new Date());

export const PROVIDERS = ["google", "icloud", "notion", "strava", "hevy", "anthropic", "reminders"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A connected account. Credentials are encrypted (see server/crypto.ts) and never leave the server. */
export const integration = sqliteTable("integration", {
  provider: text("provider", { enum: PROVIDERS }).primaryKey(),
  status: text("status", { enum: ["connected", "error"] }).notNull(),
  account: text("account"), // display label, e.g. an email address
  credentials: text("credentials").notNull(),
  lastError: text("last_error"),
  connectedAt: createdAt("connected_at"),
});

export const FEEDS = [
  "google_calendar",
  "icloud_calendar",
  "gmail",
  "icloud_mail",
  "notion",
  "strava",
  "hevy",
  "reminders",
] as const;
export type Feed = (typeof FEEDS)[number];

/** One thing we sync from a provider. Lets e.g. Gmail be switched off while Google Calendar stays on. */
export const feed = sqliteTable("feed", {
  key: text("key", { enum: FEEDS }).primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
});

export const syncRun = sqliteTable(
  "sync_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feed: text("feed", { enum: FEEDS }).notNull(),
    trigger: text("trigger", { enum: ["schedule", "manual", "startup", "connect"] }).notNull(),
    startedAt: createdAt("started_at"),
    finishedAt: timestamp("finished_at"),
    ok: integer("ok", { mode: "boolean" }),
    items: integer("items"),
    error: text("error"),
  },
  (t) => [index("sync_run_feed_idx").on(t.feed, t.startedAt)],
);

export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const CALENDAR_SOURCES = ["google", "icloud"] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

export const calendar = sqliteTable(
  "calendar",
  {
    id: text("id").primaryKey(), // `${source}:${externalId}`
    source: text("source", { enum: CALENDAR_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
    role: text("role", { enum: ["normal", "plan", "training"] }).notNull().default("normal"),
  },
  (t) => [uniqueIndex("calendar_source_ext_idx").on(t.source, t.externalId)],
);

export const EVENT_KINDS = ["run", "training", "plan", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Cached calendar events, recurring events expanded into single occurrences. */
export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(), // `${calendarId}|${externalId}|${startMs}`
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendar.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    kind: text("kind", { enum: EVENT_KINDS }).notNull().default("other"),
  },
  (t) => [index("event_start_idx").on(t.startAt), index("event_calendar_idx").on(t.calendarId, t.startAt)],
);

// ── Goals (mirror of Notion; Notion is the source of truth) ────────────────

export const GOAL_CATEGORIES = ["fitness", "work", "personal", "relationship"] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export const MEASURES = ["number", "steps", "habit", "done"] as const;
export type Measure = (typeof MEASURES)[number];

export const goal = sqliteTable("goal", {
  id: text("id").primaryKey(), // Notion page id
  title: text("title").notNull(),
  category: text("category", { enum: GOAL_CATEGORIES }).notNull(),
  priority: text("priority", { enum: ["main", "secondary"] }).notNull(),
  why: text("why"),
  targetDate: text("target_date"), // YYYY-MM-DD
  measure: text("measure", { enum: MEASURES }).notNull(),
  habitPeriod: text("habit_period", { enum: ["week", "month"] }),
  habitMin: integer("habit_min"),
  habitMax: integer("habit_max"),
  startValue: real("start_value"),
  targetValue: real("target_value"),
  unit: text("unit"),
  status: text("status", { enum: ["active", "paused", "done", "dropped"] }).notNull(),
  notionEditedAt: timestamp("notion_edited_at"),
});

export const STEP_STATUSES = ["todo", "planned", "done", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const step = sqliteTable(
  "step",
  {
    id: text("id").primaryKey(), // Notion page id
    goalId: text("goal_id"), // not a FK: Notion may briefly hold a step whose goal we haven't synced
    title: text("title").notNull(),
    estimateMin: integer("estimate_min"),
    status: text("status", { enum: STEP_STATUSES }).notNull(),
    due: text("due"), // YYYY-MM-DD
    order: integer("order"),
    doneOn: text("done_on"), // YYYY-MM-DD
    notionEditedAt: timestamp("notion_edited_at"),
  },
  (t) => [index("step_goal_idx").on(t.goalId)],
);

export const book = sqliteTable("book", {
  id: text("id").primaryKey(), // Notion page id
  title: text("title").notNull(),
  totalPages: integer("total_pages"),
  currentPage: integer("current_page"),
  status: text("status", { enum: ["reading", "finished"] }).notNull(),
  startedOn: text("started_on"),
  finishedOn: text("finished_on"),
  notionEditedAt: timestamp("notion_edited_at"),
});

// ── Manual logs (local only) ───────────────────────────────────────────────

export const readingLog = sqliteTable(
  "reading_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: text("book_id").notNull(),
    page: integer("page").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    createdAt: createdAt(),
  },
  (t) => [index("reading_log_book_idx").on(t.bookId, t.date)],
);

export const weightLog = sqliteTable(
  "weight_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    kg: real("kg").notNull(),
    source: text("source", { enum: ["manual", "hevy"] }).notNull(),
  },
  (t) => [uniqueIndex("weight_log_date_source_idx").on(t.date, t.source)],
);

export const reelLog = sqliteTable("reel_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

/** "I did it" for a planned run/gym session that Strava/Hevy didn't record. */
export const habitConfirmation = sqliteTable(
  "habit_confirmation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    habit: text("habit", { enum: ["run", "training"] }).notNull(),
    date: text("date").notNull(),
    eventId: text("event_id"), // calendar event it confirms, if any
    createdAt: createdAt(),
  },
  (t) => [index("habit_confirmation_date_idx").on(t.date)],
);

// ── Strava and Hevy ────────────────────────────────────────────────────────

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(), // Strava activity id
    name: text("name").notNull(),
    sportType: text("sport_type").notNull(),
    startAt: timestamp("start_at").notNull(),
    movingSeconds: integer("moving_seconds"),
    elapsedSeconds: integer("elapsed_seconds"),
    distanceM: real("distance_m"),
    externalId: text("external_id"), // e.g. set by apps that upload to Strava (Hevy, Garmin)
  },
  (t) => [index("activity_start_idx").on(t.startAt)],
);

export const workout = sqliteTable(
  "workout",
  {
    id: text("id").primaryKey(), // Hevy workout id
    title: text("title").notNull(),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    volumeKg: real("volume_kg").notNull(),
    setCount: integer("set_count").notNull(),
    hevyUpdatedAt: timestamp("hevy_updated_at"),
  },
  (t) => [index("workout_start_idx").on(t.startAt)],
);

export const workoutSet = sqliteTable(
  "workout_set",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workout.id, { onDelete: "cascade" }),
    exerciseIndex: integer("exercise_index").notNull(),
    exerciseTemplateId: text("exercise_template_id"),
    exerciseTitle: text("exercise_title").notNull(),
    setIndex: integer("set_index").notNull(),
    setType: text("set_type").notNull(), // normal | warmup | dropset | failure
    weightKg: real("weight_kg"),
    reps: integer("reps"),
    rpe: real("rpe"),
  },
  (t) => [index("workout_set_workout_idx").on(t.workoutId), index("workout_set_exercise_idx").on(t.exerciseTitle)],
);

// ── Mail and reminders (read-only caches) ──────────────────────────────────

export const MAIL_CATEGORIES = ["needs_reply", "fyi", "ignore"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

/** Only what the summary needs: sender, subject, snippet. Bodies are never stored. */
export const mailThread = sqliteTable(
  "mail_thread",
  {
    id: text("id").primaryKey(), // `${feed}:${threadId}`
    source: text("source", { enum: ["gmail", "icloud_mail"] }).notNull(),
    threadId: text("thread_id").notNull(),
    sender: text("sender").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    receivedAt: timestamp("received_at").notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull(),
    category: text("category", { enum: MAIL_CATEGORIES }),
    summary: text("summary"),
    summarizedAt: timestamp("summarized_at"),
  },
  (t) => [index("mail_thread_received_idx").on(t.receivedAt)],
);

export const reminder = sqliteTable("reminder", {
  id: text("id").primaryKey(), // Reminders app id
  list: text("list").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at"),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  priority: integer("priority").notNull().default(0),
});

// ── Day plan and AI log ────────────────────────────────────────────────────

export const dayPlan = sqliteTable(
  "day_plan",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(), // YYYY-MM-DD
    trigger: text("trigger", { enum: ["schedule", "first_open", "replan", "desktop"] }).notNull(),
    brief: text("brief").notNull(),
    topStepIds: text("top_step_ids", { mode: "json" }).$type<string[]>().notNull(),
    aiRunId: integer("ai_run_id"),
    createdAt: createdAt(),
  },
  (t) => [index("day_plan_date_idx").on(t.date)],
);

export const BLOCK_KINDS = ["step", "run", "training", "reading", "other"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const proposedBlock = sqliteTable(
  "proposed_block",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dayPlanId: integer("day_plan_id")
      .notNull()
      .references(() => dayPlan.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    kind: text("kind", { enum: BLOCK_KINDS }).notNull(),
    title: text("title").notNull(),
    stepId: text("step_id"),
    reason: text("reason"),
    status: text("status", { enum: ["proposed", "approved", "skipped", "superseded"] }).notNull().default("proposed"),
    googleEventId: text("google_event_id"),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [index("proposed_block_plan_idx").on(t.dayPlanId)],
);

export const AI_JOBS = ["morning_plan", "mail_summary", "weekly_review", "evening_checkin", "break_steps"] as const;

/** Every AI call: what was sent (already minimised), what came back. */
export const aiRun = sqliteTable(
  "ai_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    job: text("job", { enum: AI_JOBS }).notNull(),
    model: text("model").notNull(),
    input: text("input", { mode: "json" }).notNull(),
    output: text("output", { mode: "json" }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_run_job_idx").on(t.job, t.createdAt)],
);

/** Your decision on each AI suggestion. */
export const aiDecision = sqliteTable("ai_decision", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  aiRunId: integer("ai_run_id"),
  item: text("item").notNull(), // e.g. "block:12", "review:3"
  decision: text("decision", { enum: ["approved", "edited", "skipped", "removed"] }).notNull(),
  before: text("before", { mode: "json" }),
  after: text("after", { mode: "json" }),
  decidedAt: createdAt("decided_at"),
});

/**
 * An AI suggestion waiting for your decision that isn't a day block, e.g. steps for a goal.
 * Comes from the Claude API or from Claude Desktop (MCP); nothing is written until you approve.
 */
export const aiProposal = sqliteTable("ai_proposal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["goal_steps"] }).notNull(),
  targetId: text("target_id").notNull(), // e.g. goal id
  payload: text("payload", { mode: "json" }).notNull(),
  source: text("source", { enum: ["api", "desktop"] }).notNull(),
  status: text("status", { enum: ["pending", "applied", "dismissed"] }).notNull().default("pending"),
  aiRunId: integer("ai_run_id"),
  createdAt: createdAt(),
});

export const review = sqliteTable(
  "review",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ["daily", "weekly"] }).notNull(),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD
    periodEnd: text("period_end").notNull(), // inclusive
    notes: text("notes"), // what you added before the draft
    draft: text("draft"), // AI draft (API or Claude Desktop)
    final: text("final"), // what you confirmed
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("draft"),
    source: text("source", { enum: ["api", "desktop", "manual"] }),
    notionPageId: text("notion_page_id"),
    aiRunId: integer("ai_run_id"),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [uniqueIndex("review_type_period_idx").on(t.type, t.periodStart)],
);

// ── Better Auth (sign-in only) ──────────────────────────────────────────────
// Shape required by Better Auth's Drizzle adapter. Google tokens stored here come from
// sign-in (openid email profile) and are encrypted by Better Auth (encryptOAuthTokens).
// Calendar/Gmail access lives in `integration`, not here.

const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

export const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSession = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const authAccount = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const authVerification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
