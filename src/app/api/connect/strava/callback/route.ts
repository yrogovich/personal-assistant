import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { completeStravaConnect } from "@/server/integrations/strava";
import { syncProvider } from "@/server/sync/run";

export async function GET(req: NextRequest) {
  await requireUser();
  const jar = await cookies();
  const expected = jar.get("strava_oauth_state")?.value;
  jar.delete({ name: "strava_oauth_state", path: "/api/connect/strava" });

  const params = req.nextUrl.searchParams;
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?${query}`, req.url));

  if (params.get("error")) return back(`error=${encodeURIComponent(`Strava: ${params.get("error")}`)}`);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return back("error=state_mismatch");

  try {
    await completeStravaConnect(code, params.get("scope"));
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "connect_failed")}`);
  }
  await syncProvider("strava", "connect");
  return back("connected=strava");
}
