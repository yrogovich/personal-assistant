import "server-only";
import { calendar as googleCalendar, type calendar_v3 } from "@googleapis/calendar";
import { dateOnlyInTz } from "@/lib/time";
import { env } from "../../env";
import {
  clearEvents,
  replaceEvents,
  upsertCalendars,
  type FetchedEvent,
  type SyncWindow,
} from "../calendar-store";
import { NotConnectedError } from "../store";
import { googleClient, rethrowGoogleError } from "./oauth";

function toFetched(e: calendar_v3.Schema$Event, tz: string): FetchedEvent | null {
  if (e.status === "cancelled" || !e.id || !e.start || !e.end) return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const allDay = Boolean(e.start.date);
  const parse = (t: calendar_v3.Schema$EventDateTime) => {
    if (t.dateTime) return new Date(t.dateTime);
    const [y, m, d] = t.date!.split("-").map(Number);
    return dateOnlyInTz(y, m, d, tz);
  };
  return {
    externalId: e.id,
    title: e.summary?.trim() || "(no title)",
    location: e.location ?? null,
    startAt: parse(e.start),
    endAt: parse(e.end),
    allDay,
  };
}

export async function syncGoogleCalendar(window: SyncWindow): Promise<number> {
  const auth = await googleClient();
  if (!auth) throw new NotConnectedError("google");
  const api = googleCalendar({ version: "v3", auth });
  const tz = env().APP_TIMEZONE;

  try {
    const list = await api.calendarList.list({ maxResults: 250 });
    const calendars = await upsertCalendars(
      "google",
      (list.data.items ?? [])
        .filter((c) => c.id)
        .map((c) => ({
          externalId: c.id!,
          name: c.summaryOverride ?? c.summary ?? c.id!,
          color: c.backgroundColor ?? null,
          defaultIncluded: Boolean(c.primary || c.selected),
        })),
    );

    let total = 0;
    for (const cal of calendars) {
      if (!cal.included) {
        await clearEvents(cal.id);
        continue;
      }
      const events: FetchedEvent[] = [];
      let pageToken: string | undefined;
      do {
        const res = await api.events.list({
          calendarId: cal.externalId,
          timeMin: window.start.toISOString(),
          timeMax: window.end.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        });
        for (const item of res.data.items ?? []) {
          const f = toFetched(item, tz);
          if (f) events.push(f);
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      total += await replaceEvents(cal, events, window);
    }
    return total;
  } catch (err) {
    rethrowGoogleError(err);
  }
}
