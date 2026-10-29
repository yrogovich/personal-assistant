import "server-only";
import { isFullDatabase, type Client } from "@notionhq/client";
import { setSetting, type NotionDataSources } from "../../settings";
import { notionClient, rethrowNotionError, write } from "./client";
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
import { SEED_GOALS } from "./seed";

// Notion allows ~3 requests/second per integration.
const pause = () => new Promise((r) => setTimeout(r, 350));

const select = (options: string[]) => ({ select: { options: options.map((name) => ({ name })) } });

async function createDatabase(
  notion: Client,
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
): Promise<string> {
  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ text: { content: title } }],
    // Property configs are checked by Notion; the SDK's union type is too wide to spell out here.
    initial_data_source: { properties: properties as never },
  });
  await pause();
  const ds = isFullDatabase(db) ? db.data_sources[0] : undefined;
  if (!ds) throw new Error(`Notion created "${title}" but returned no data source`);
  return ds.id;
}

/** Data source ids of databases already under the Dashboard page, by title. */
async function existingDatabases(notion: Client, parentPageId: string): Promise<Partial<NotionDataSources>> {
  const found: Partial<NotionDataSources> = {};
  const titles: Record<string, keyof NotionDataSources> = { Goals: "goals", Steps: "steps", Books: "books", Reviews: "reviews" };
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: parentPageId, start_cursor: cursor, page_size: 100 });
    for (const block of res.results) {
      if (!("type" in block) || block.type !== "child_database") continue;
      const key = titles[block.child_database.title];
      if (!key || found[key]) continue;
      const db = await notion.databases.retrieve({ database_id: block.id });
      if (isFullDatabase(db) && db.data_sources[0]) found[key] = db.data_sources[0].id;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return found;
}

/**
 * Creates the four databases under the Dashboard page. Safe to call again: databases that
 * already exist there (by title) are reused, so reconnecting never creates duplicates.
 */
export async function setupNotionDatabases(): Promise<NotionDataSources> {
  const { notion, creds } = await notionClient();
  try {
    const found = await existingDatabases(notion, creds.parentPageId);
    if (found.goals && found.steps && found.books && found.reviews) {
      const ids = found as NotionDataSources;
      await setSetting("notionDataSources", ids);
      return ids;
    }
    if (found.goals || found.steps || found.books || found.reviews) {
      throw new Error(
        "The Dashboard page has some but not all of Goals, Steps, Books and Reviews. Remove or rename them, then retry.",
      );
    }
    const goals = await createDatabase(notion, creds.parentPageId, "Goals", {
      [GOALS.name]: { title: {} },
      [GOALS.category]: select(CATEGORY.options),
      [GOALS.priority]: select(PRIORITY.options),
      [GOALS.why]: { rich_text: {} },
      [GOALS.targetDate]: { date: {} },
      [GOALS.measure]: select(MEASURE.options),
      [GOALS.habitPeriod]: select(HABIT_PERIOD.options),
      [GOALS.habitMin]: { number: {} },
      [GOALS.habitMax]: { number: {} },
      [GOALS.start]: { number: {} },
      [GOALS.target]: { number: {} },
      [GOALS.unit]: { rich_text: {} },
      [GOALS.status]: select(GOAL_STATUS.options),
    });
    const steps = await createDatabase(notion, creds.parentPageId, "Steps", {
      [STEPS.title]: { title: {} },
      [STEPS.goal]: {
        relation: { data_source_id: goals, type: "dual_property", dual_property: { synced_property_name: GOALS.steps } },
      },
      [STEPS.estimate]: { number: {} },
      [STEPS.status]: select(STEP_STATUS.options),
      [STEPS.due]: { date: {} },
      [STEPS.order]: { number: {} },
      [STEPS.doneOn]: { date: {} },
    });
    const books = await createDatabase(notion, creds.parentPageId, "Books", {
      [BOOKS.title]: { title: {} },
      [BOOKS.totalPages]: { number: {} },
      [BOOKS.currentPage]: { number: {} },
      [BOOKS.status]: select(BOOK_STATUS.options),
      [BOOKS.started]: { date: {} },
      [BOOKS.finished]: { date: {} },
    });
    const reviews = await createDatabase(notion, creds.parentPageId, "Reviews", {
      [REVIEWS.title]: { title: {} },
      [REVIEWS.type]: select(REVIEW_TYPE.options),
      [REVIEWS.period]: { date: {} },
      [REVIEWS.status]: select(REVIEW_STATUS.options),
    });
    const ids = { goals, steps, books, reviews };
    await setSetting("notionDataSources", ids);
    return ids;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("The Dashboard page has")) throw err;
    rethrowNotionError(err);
  }
}

/** Writes the v1 goals and steps. Skips entirely if the Goals database already has rows. */
export async function seedNotion(ids: NotionDataSources): Promise<{ goals: number; steps: number }> {
  const { notion } = await notionClient();
  try {
    const existing = await notion.dataSources.query({ data_source_id: ids.goals, page_size: 1 });
    if (existing.results.length > 0) return { goals: 0, steps: 0 };

    let goalCount = 0;
    let stepCount = 0;
    for (const g of SEED_GOALS) {
      const page = await notion.pages.create({
        parent: { type: "data_source_id", data_source_id: ids.goals },
        properties: {
          [GOALS.name]: write.title(g.title),
          [GOALS.category]: write.select(CATEGORY.toNotion(g.category)),
          [GOALS.priority]: write.select(PRIORITY.toNotion(g.priority)),
          [GOALS.why]: write.text(g.why ?? null),
          [GOALS.targetDate]: write.date(g.targetDate ?? null),
          [GOALS.measure]: write.select(MEASURE.toNotion(g.measure)),
          [GOALS.habitPeriod]: write.select(g.habit ? HABIT_PERIOD.toNotion(g.habit.period) : null),
          [GOALS.habitMin]: write.number(g.habit?.min ?? null),
          [GOALS.habitMax]: write.number(g.habit?.max ?? null),
          [GOALS.start]: write.number(g.number?.start ?? null),
          [GOALS.target]: write.number(g.number?.target ?? null),
          [GOALS.unit]: write.text(g.number?.unit ?? null),
          [GOALS.status]: write.select(GOAL_STATUS.toNotion("active")),
        },
      });
      goalCount++;
      await pause();
      for (const [i, [title, estimate]] of (g.steps ?? []).entries()) {
        await notion.pages.create({
          parent: { type: "data_source_id", data_source_id: ids.steps },
          properties: {
            [STEPS.title]: write.title(title),
            [STEPS.goal]: write.relation([page.id]),
            [STEPS.estimate]: write.number(estimate),
            [STEPS.status]: write.select(STEP_STATUS.toNotion("todo")),
            [STEPS.order]: write.number(i + 1),
          },
        });
        stepCount++;
        await pause();
      }
    }
    return { goals: goalCount, steps: stepCount };
  } catch (err) {
    rethrowNotionError(err);
  }
}
