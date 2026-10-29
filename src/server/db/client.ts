import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import * as schema from "./schema";

function create() {
  const url = env().DATABASE_URL;
  if (url.startsWith("file:")) mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  return drizzle({ connection: { url }, schema });
}

export type Db = ReturnType<typeof create>;

// One client per process, survives dev hot reloads.
const g = globalThis as unknown as { __paDb?: Db };

export function db(): Db {
  g.__paDb ??= create();
  return g.__paDb;
}
