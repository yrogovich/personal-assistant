import "server-only";
import { collectPaginatedAPI, isFullPage, type Client, type PageObjectResponse } from "@notionhq/client";
import { notInArray } from "drizzle-orm";
import { db } from "../../db/client";
import { book, goal, step, type GoalCategory, type Measure, type StepStatus } from "../../db/schema";
import { getSetting } from "../../settings";
import {
  notionClient,
  readDate,
  readNumber,
  readRelation,
  readSelect,
  readText,
  readTitle,
  rethrowNotionError,
  write,
} from "./client";
import {
  BOOK_STATUS,
  BOOKS,
  CATEGORY,
  GOAL_STATUS,
  GOALS,
  HABIT_PERIOD,
  MEASURE,
  PRIORITY,
  REVIEW_STATUS,
  REVIEW_TYPE,
  REVIEWS,
  STEP_STATUS,
  STEPS,
} from "./schema";

async function allPages(notion: Client, dataSourceId: string): Promise<PageObjectResponse[]> {
  const rows = await collectPaginatedAPI(notion.dataSources.query, { data_source_id: dataSourceId, page_size: 100 });
  return rows.filter(isFullPage).filter((p) => !p.in_trash);
}

const intOrNull = (n: number | null) => (n === null ? null : Math.round(n));

/** Mirrors Goals, Steps and Books into SQLite. Rows deleted in Notion are deleted here. */
export async function syncNotion(): Promise<number> {
  const ids = await getSetting("notionDataSources");
  if (!ids) throw new Error("Notion databases aren't set up yet. Finish setup in Settings.");
  const { notion } = await notionClient();

  let goals: PageObjectResponse[], steps: PageObjectResponse[], books: PageObjectResponse[];
  try {
    goals = await allPages(notion, ids.goals);
    steps = await allPages(notion, ids.steps);
    books = await allPages(notion, ids.books);
  } catch (err) {
    rethrowNotionError(err);
  }

  const goalRows = goals.map((p) => {
    const pr = p.properties;
    return {
      id: p.id,
      title: readTitle(pr, GOALS.name) || "(untitled goal)",
      category: CATEGORY.fromNotion(readSelect(pr, GOALS.category)) ?? "personal",
      priority: PRIORITY.fromNotion(readSelect(pr, GOALS.priority)) ?? "secondary",
      why: readText(pr, GOALS.why),
      targetDate: readDate(pr, GOALS.targetDate),
      measure: MEASURE.fromNotion(readSelect(pr, GOALS.measure)) ?? "done",
      habitPeriod: HABIT_PERIOD.fromNotion(readSelect(pr, GOALS.habitPeriod)) ?? null,
      habitMin: intOrNull(readNumber(pr, GOALS.habitMin)),
      habitMax: intOrNull(readNumber(pr, GOALS.habitMax)),
      startValue: readNumber(pr, GOALS.start),
      targetValue: readNumber(pr, GOALS.target),
      unit: readText(pr, GOALS.unit),
      status: GOAL_STATUS.fromNotion(readSelect(pr, GOALS.status)) ?? "active",
      notionEditedAt: new Date(p.last_edited_time),
    } satisfies typeof goal.$inferInsert;
  });

  const stepRows = steps.map((p) => {
    const pr = p.properties;
    return {
      id: p.id,
      goalId: readRelation(pr, STEPS.goal)[0] ?? null,
      title: readTitle(pr, STEPS.title) || "(untitled step)",
      estimateMin: intOrNull(readNumber(pr, STEPS.estimate)),
      status: STEP_STATUS.fromNotion(readSelect(pr, STEPS.status)) ?? "todo",
      due: readDate(pr, STEPS.due),
      order: intOrNull(readNumber(pr, STEPS.order)),
      doneOn: readDate(pr, STEPS.doneOn),
      notionEditedAt: new Date(p.last_edited_time),
    } satisfies typeof step.$inferInsert;
  });

  const bookRows = books.map((p) => {
    const pr = p.properties;
    return {
      id: p.id,
      title: readTitle(pr, BOOKS.title) || "(untitled book)",
      totalPages: intOrNull(readNumber(pr, BOOKS.totalPages)),
      currentPage: intOrNull(readNumber(pr, BOOKS.currentPage)),
      status: BOOK_STATUS.fromNotion(readSelect(pr, BOOKS.status)) ?? "reading",
      startedOn: readDate(pr, BOOKS.started),
      finishedOn: readDate(pr, BOOKS.finished),
      notionEditedAt: new Date(p.last_edited_time),
    } satisfies typeof book.$inferInsert;
  });

  await db().transaction(async (tx) => {
    for (const [table, rows] of [
      [goal, goalRows],
      [step, stepRows],
      [book, bookRows],
    ] as const) {
      const keep = rows.map((r) => r.id);
      await tx.delete(table).where(keep.length ? notInArray(table.id, keep) : undefined);
      for (const r of rows) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...rest } = r;
        await tx.insert(table).values(r as never).onConflictDoUpdate({ target: table.id, set: rest as never });
      }
    }
  });
  return goalRows.length + stepRows.length + bookRows.length;
}

// ── Writes (only ever from an explicit user action) ─────────────────────────

export async function createBookInNotion(input: { title: string; totalPages: number; startedOn: string }): Promise<string> {
  const ids = await getSetting("notionDataSources");
  if (!ids) throw new Error("Notion databases aren't set up yet.");
  const { notion } = await notionClient();
  try {
    const page = await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: ids.books },
      properties: {
        [BOOKS.title]: write.title(input.title),
        [BOOKS.totalPages]: write.number(input.totalPages),
        [BOOKS.currentPage]: write.number(0),
        [BOOKS.status]: write.select(BOOK_STATUS.toNotion("reading")),
        [BOOKS.started]: write.date(input.startedOn),
      },
    });
    return page.id;
  } catch (err) {
    rethrowNotionError(err);
  }
}

export async function updateBookProgressInNotion(
  bookId: string,
  input: { currentPage: number; finishedOn: string | null },
): Promise<void> {
  const { notion } = await notionClient();
  try {
    await notion.pages.update({
      page_id: bookId,
      properties: {
        [BOOKS.currentPage]: write.number(input.currentPage),
        ...(input.finishedOn
          ? { [BOOKS.status]: write.select(BOOK_STATUS.toNotion("finished")), [BOOKS.finished]: write.date(input.finishedOn) }
          : {}),
      },
    });
  } catch (err) {
    rethrowNotionError(err);
  }
}

export async function markStepDoneInNotion(stepId: string, doneOn: string): Promise<void> {
  const { notion } = await notionClient();
  try {
    await notion.pages.update({
      page_id: stepId,
      properties: {
        [STEPS.status]: write.select(STEP_STATUS.toNotion("done")),
        [STEPS.doneOn]: write.date(doneOn),
      },
    });
  } catch (err) {
    rethrowNotionError(err);
  }
}

// ── Goals and steps (your own edits from the Goals screen, or steps you approved) ──

export type GoalInput = {
  title: string;
  category: GoalCategory;
  priority: "main" | "secondary";
  why: string | null;
  targetDate: string | null;
  measure: Measure;
  status: "active" | "paused" | "done" | "dropped";
};

const goalProps = (g: GoalInput) => ({
  [GOALS.name]: write.title(g.title),
  [GOALS.category]: write.select(CATEGORY.toNotion(g.category)),
  [GOALS.priority]: write.select(PRIORITY.toNotion(g.priority)),
  [GOALS.why]: write.text(g.why),
  [GOALS.targetDate]: write.date(g.targetDate),
  [GOALS.measure]: write.select(MEASURE.toNotion(g.measure)),
  [GOALS.status]: write.select(GOAL_STATUS.toNotion(g.status)),
});

export async function saveGoalInNotion(id: string | null, g: GoalInput): Promise<string> {
  const ids = await getSetting("notionDataSources");
  if (!ids) throw new Error("Notion databases aren't set up yet.");
  const { notion } = await notionClient();
  try {
    if (id) {
      await notion.pages.update({ page_id: id, properties: goalProps(g) });
      return id;
    }
    const page = await notion.pages.create({ parent: { type: "data_source_id", data_source_id: ids.goals }, properties: goalProps(g) });
    return page.id;
  } catch (err) {
    rethrowNotionError(err);
  }
}

export type StepInput = { title: string; estimateMin: number | null; due: string | null; status: StepStatus };

export async function createStepsInNotion(goalId: string, steps: StepInput[], firstOrder: number): Promise<number> {
  const ids = await getSetting("notionDataSources");
  if (!ids) throw new Error("Notion databases aren't set up yet.");
  const { notion } = await notionClient();
  try {
    for (const [i, s] of steps.entries()) {
      await notion.pages.create({
        parent: { type: "data_source_id", data_source_id: ids.steps },
        properties: {
          [STEPS.title]: write.title(s.title),
          [STEPS.goal]: write.relation([goalId]),
          [STEPS.estimate]: write.number(s.estimateMin),
          [STEPS.status]: write.select(STEP_STATUS.toNotion(s.status)),
          [STEPS.due]: write.date(s.due),
          [STEPS.order]: write.number(firstOrder + i),
        },
      });
      await new Promise((r) => setTimeout(r, 350)); // Notion rate limit
    }
    return steps.length;
  } catch (err) {
    rethrowNotionError(err);
  }
}

export async function updateStepInNotion(stepId: string, s: StepInput & { doneOn: string | null }): Promise<void> {
  const { notion } = await notionClient();
  try {
    await notion.pages.update({
      page_id: stepId,
      properties: {
        [STEPS.title]: write.title(s.title),
        [STEPS.estimate]: write.number(s.estimateMin),
        [STEPS.status]: write.select(STEP_STATUS.toNotion(s.status)),
        [STEPS.due]: write.date(s.due),
        [STEPS.doneOn]: write.date(s.doneOn),
      },
    });
  } catch (err) {
    rethrowNotionError(err);
  }
}

// ── Reviews (saved only when you confirm) ──

/** Minimal markdown → Notion blocks: "## " headings, "- " bullets, everything else paragraphs. */
function markdownBlocks(md: string) {
  const rich = (text: string) =>
    (text.match(/[\s\S]{1,1900}/g) ?? [""]).map((content) => ({ type: "text" as const, text: { content } }));
  return md
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .map((line) => {
      if (line.startsWith("## ")) return { object: "block" as const, type: "heading_2" as const, heading_2: { rich_text: rich(line.slice(3)) } };
      if (/^[-*] /.test(line))
        return { object: "block" as const, type: "bulleted_list_item" as const, bulleted_list_item: { rich_text: rich(line.slice(2)) } };
      return { object: "block" as const, type: "paragraph" as const, paragraph: { rich_text: rich(line.replace(/^#+\s*/, "")) } };
    })
    .slice(0, 100);
}

export async function createReviewInNotion(input: {
  title: string;
  type: "daily" | "weekly";
  periodStart: string;
  periodEnd: string;
  markdown: string;
}): Promise<string> {
  const ids = await getSetting("notionDataSources");
  if (!ids) throw new Error("Notion databases aren't set up yet.");
  const { notion } = await notionClient();
  try {
    const page = await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: ids.reviews },
      properties: {
        [REVIEWS.title]: write.title(input.title),
        [REVIEWS.type]: write.select(REVIEW_TYPE.toNotion(input.type)),
        [REVIEWS.period]: write.date(input.periodStart, input.periodEnd === input.periodStart ? null : input.periodEnd),
        [REVIEWS.status]: write.select(REVIEW_STATUS.toNotion("confirmed")),
      },
      children: markdownBlocks(input.markdown),
    });
    return page.id;
  } catch (err) {
    rethrowNotionError(err);
  }
}
