import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./db/client";
import { env } from "./env";
import { startScheduler } from "./sync/scheduler";

/** Runs once per server start (see src/instrumentation.ts). */
export async function boot() {
  env(); // fail fast with a readable message when .env.local is incomplete
  await migrate(db(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  startScheduler();
}
