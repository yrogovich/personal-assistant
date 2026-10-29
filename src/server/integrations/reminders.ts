import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addDays } from "date-fns";
import { notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { reminder } from "../db/schema";

// Apple Reminders, read-only. Since iOS 13 ("upgraded" reminders) iCloud no longer serves reminders
// over CalDAV, so we read them from the Reminders app on this Mac via JXA (osascript).
// The first run makes macOS ask for permission to control Reminders.

const run = promisify(execFile);

// Bulk property reads (one Apple Event per property per list) keep this fast.
const SCRIPT = `
const app = Application("Reminders");
const out = [];
for (const list of app.lists()) {
  const rs = list.reminders.whose({ completed: false });
  const ids = rs.id(), names = rs.name(), dues = rs.dueDate(), flags = rs.flagged(), prios = rs.priority();
  let allDay = [];
  try { allDay = rs.alldayDueDate(); } catch (e) {}
  for (let i = 0; i < ids.length; i++) {
    out.push({
      id: ids[i], list: list.name(), title: names[i],
      due: dues[i] ? dues[i].toISOString() : (allDay[i] ? allDay[i].toISOString() : null),
      allDay: !dues[i] && !!allDay[i], flagged: !!flags[i], priority: prios[i] || 0
    });
  }
}
JSON.stringify(out);
`;

type RawReminder = {
  id: string;
  list: string;
  title: string;
  due: string | null;
  allDay: boolean;
  flagged: boolean;
  priority: number;
};

export class RemindersPermissionError extends Error {}

async function readReminders(): Promise<RawReminder[]> {
  if (process.platform !== "darwin") throw new Error("Apple Reminders sync only works on macOS.");
  try {
    const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", SCRIPT], { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout.trim() || "[]") as RawReminder[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/-1743|not authori[sz]ed|Not allowed/i.test(message)) {
      throw new RemindersPermissionError(
        "macOS blocked access to Reminders. Allow it in System Settings → Privacy & Security → Automation (for the app running the dashboard), then retry.",
      );
    }
    throw new Error(`Couldn't read Reminders: ${message.split("\n")[0]}`);
  }
}

/** Throws if Reminders can't be read (e.g. permission denied). Returns the number of open reminders. */
export async function testReminders(): Promise<number> {
  return (await readReminders()).length;
}

const HORIZON_DAYS = 14;

/** Keeps open reminders that are due within two weeks (or overdue), or flagged. */
export async function syncReminders(): Promise<number> {
  const horizon = addDays(new Date(), HORIZON_DAYS);
  const rows = (await readReminders())
    .map((r) => ({ ...r, dueAt: r.due ? new Date(r.due) : null }))
    .filter((r) => r.flagged || (r.dueAt && r.dueAt <= horizon))
    .map((r) => ({
      id: r.id,
      list: r.list,
      title: r.title || "(untitled)",
      dueAt: r.dueAt,
      allDay: r.allDay,
      flagged: r.flagged,
      priority: r.priority,
    }));
  await db().transaction(async (tx) => {
    const ids = rows.map((r) => r.id);
    await tx.delete(reminder).where(ids.length ? notInArray(reminder.id, ids) : undefined);
    for (const r of rows) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...rest } = r;
      await tx.insert(reminder).values(r).onConflictDoUpdate({ target: reminder.id, set: rest });
    }
  });
  return rows.length;
}

export async function clearReminders() {
  await db().delete(reminder);
}
