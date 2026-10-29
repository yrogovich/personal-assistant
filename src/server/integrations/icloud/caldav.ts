import "server-only";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { env } from "../../env";
import { clearEvents, replaceEvents, upsertCalendars, type SyncWindow } from "../calendar-store";
import { AuthRevokedError, getCredentials, NotConnectedError } from "../store";
import { expandIcs } from "./ics";

/** One app-specific password covers both CalDAV and IMAP. */
export type IcloudCredentials = { appleId: string; appPassword: string };

async function davClient(creds: IcloudCredentials) {
  try {
    return await createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: creds.appleId, password: creds.appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|unauthori[sz]ed|invalid credentials/i.test(message)) {
      throw new AuthRevokedError("iCloud rejected the Apple ID or app-specific password.");
    }
    throw err;
  }
}

const isEventCalendar = (c: DAVCalendar) => !c.components || c.components.includes("VEVENT");

function displayName(c: DAVCalendar): string {
  return typeof c.displayName === "string" && c.displayName.trim() ? c.displayName : "iCloud calendar";
}

/** Throws if the credentials don't work. Returns the number of event calendars found. */
export async function testIcloudCalendar(creds: IcloudCredentials): Promise<number> {
  const client = await davClient(creds);
  return (await client.fetchCalendars()).filter(isEventCalendar).length;
}

// tsdav wants ISO 8601 without milliseconds.
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function syncIcloudCalendar(window: SyncWindow): Promise<number> {
  const creds = await getCredentials<IcloudCredentials>("icloud");
  if (!creds) throw new NotConnectedError("icloud");
  const client = await davClient(creds);
  const tz = env().APP_TIMEZONE;

  const remote = (await client.fetchCalendars()).filter(isEventCalendar);
  const calendars = await upsertCalendars(
    "icloud",
    remote.map((c) => ({
      externalId: c.url,
      name: displayName(c),
      color: c.calendarColor?.slice(0, 7) ?? null, // iCloud sends #RRGGBBAA
      defaultIncluded: true,
    })),
  );

  let total = 0;
  for (const cal of calendars) {
    if (!cal.included) {
      await clearEvents(cal.id);
      continue;
    }
    const davCal = remote.find((r) => r.url === cal.externalId);
    if (!davCal) continue;
    const objects = await client.fetchCalendarObjects({
      calendar: davCal,
      timeRange: { start: iso(window.start), end: iso(window.end) },
    });
    const events = objects.flatMap((o) => {
      if (typeof o.data !== "string" || !o.data) return [];
      try {
        return expandIcs(o.data, window, tz);
      } catch (err) {
        console.warn(`[icloud] skipped an unparsable event in ${cal.name}:`, err instanceof Error ? err.message : err);
        return [];
      }
    });
    total += await replaceEvents(cal, events, window);
  }
  return total;
}
