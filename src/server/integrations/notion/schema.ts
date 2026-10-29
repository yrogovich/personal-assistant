import type { GoalCategory, Measure, StepStatus } from "../../db/schema";

// Notion is the source of truth for goals, steps, books and reviews.
// These are the exact property and option names the setup creates and the sync reads.

export const GOALS = {
  name: "Name",
  category: "Category",
  priority: "Priority",
  why: "Why",
  targetDate: "Target date",
  measure: "Measure",
  habitPeriod: "Habit period",
  habitMin: "Habit min",
  habitMax: "Habit max",
  start: "Start",
  target: "Target",
  unit: "Unit",
  status: "Status",
  steps: "Steps",
} as const;

export const STEPS = {
  title: "Title",
  goal: "Goal",
  estimate: "Estimate (min)",
  status: "Status",
  due: "Due",
  order: "Order",
  doneOn: "Done on",
} as const;

export const BOOKS = {
  title: "Title",
  totalPages: "Total pages",
  currentPage: "Current page",
  status: "Status",
  started: "Started",
  finished: "Finished",
} as const;

export const REVIEWS = {
  title: "Title",
  type: "Type",
  period: "Period",
  status: "Status",
} as const;

/** Two-way maps between our enum values and Notion select option names. */
function bimap<K extends string>(map: Record<K, string>) {
  const reverse = Object.fromEntries(Object.entries(map).map(([k, v]) => [String(v).toLowerCase(), k])) as Record<
    string,
    K
  >;
  return {
    toNotion: (k: K) => map[k],
    fromNotion: (name: string | null | undefined): K | undefined => (name ? reverse[name.toLowerCase()] : undefined),
    options: Object.values(map) as string[],
  };
}

export const CATEGORY = bimap<GoalCategory>({
  fitness: "Fitness & health",
  work: "Work",
  personal: "Personal",
  relationship: "Relationship",
});
export const PRIORITY = bimap<"main" | "secondary">({ main: "Main", secondary: "Secondary" });
export const MEASURE = bimap<Measure>({ number: "Number", steps: "Steps", habit: "Habit", done: "Done / not done" });
export const HABIT_PERIOD = bimap<"week" | "month">({ week: "Week", month: "Month" });
export const GOAL_STATUS = bimap<"active" | "paused" | "done" | "dropped">({
  active: "Active",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
});
export const STEP_STATUS = bimap<StepStatus>({ todo: "To do", planned: "Planned", done: "Done", skipped: "Skipped" });
export const BOOK_STATUS = bimap<"reading" | "finished">({ reading: "Reading", finished: "Finished" });
export const REVIEW_TYPE = bimap<"daily" | "weekly">({ daily: "Daily", weekly: "Weekly" });
export const REVIEW_STATUS = bimap<"draft" | "confirmed">({ draft: "Draft", confirmed: "Confirmed" });
