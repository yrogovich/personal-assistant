import "server-only";
import { calendar as googleCalendar } from "@googleapis/calendar";
import { env } from "../../env";
import { getSetting, setSetting } from "../../settings";
import { NotConnectedError } from "../store";
import { googleClient, rethrowGoogleError } from "./oauth";

// Approved blocks go into a dedicated "Plan" calendar in your Google account, created by this app
// (calendar.app.created scope: the app can only touch calendars it created itself).

async function api() {
  const auth = await googleClient();
  if (!auth) throw new NotConnectedError("google");
  return googleCalendar({ version: "v3", auth });
}

const status = (err: unknown) => (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;

export async function ensurePlanCalendar(): Promise<string> {
  const cal = await api();
  const existing = await getSetting("planCalendarId");
  try {
    if (existing) {
      try {
        await cal.calendars.get({ calendarId: existing });
        return existing;
      } catch (err) {
        if (status(err) !== 404 && status(err) !== 403) throw err;
      }
    }
    const created = await cal.calendars.insert({
      requestBody: {
        summary: "Plan",
        description: "Time blocks you approved in your dashboard.",
        timeZone: env().APP_TIMEZONE,
      },
    });
    const id = created.data.id!;
    await setSetting("planCalendarId", id);
    return id;
  } catch (err) {
    rethrowGoogleError(err);
  }
}

export async function insertPlanEvent(block: {
  id: number;
  title: string;
  reason: string | null;
  start: Date;
  end: Date;
}): Promise<string> {
  const cal = await api();
  const calendarId = await ensurePlanCalendar();
  const tz = env().APP_TIMEZONE;
  try {
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: block.title,
        description: [block.reason, "Approved in your dashboard."].filter(Boolean).join("\n\n"),
        start: { dateTime: block.start.toISOString(), timeZone: tz },
        end: { dateTime: block.end.toISOString(), timeZone: tz },
        extendedProperties: { private: { dashboardBlockId: String(block.id) } },
      },
    });
    return res.data.id!;
  } catch (err) {
    rethrowGoogleError(err);
  }
}

export async function deletePlanEvent(eventId: string): Promise<void> {
  const cal = await api();
  const calendarId = await getSetting("planCalendarId");
  if (!calendarId) return;
  try {
    await cal.events.delete({ calendarId, eventId });
  } catch (err) {
    if (status(err) === 404 || status(err) === 410) return; // already gone
    rethrowGoogleError(err);
  }
}
