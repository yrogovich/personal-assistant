import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { completeGoogleConnect } from "@/server/integrations/google/oauth";
import { syncProvider } from "@/server/sync/run";

export async function GET(req: NextRequest) {
  await requireUser();
  const jar = await cookies();
  const expected = jar.get("google_oauth_state")?.value;
  jar.delete({ name: "google_oauth_state", path: "/api/connect/google" });

  const params = req.nextUrl.searchParams;
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?${query}`, req.url));

  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error")!)}`);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return back("error=state_mismatch");

  try {
    await completeGoogleConnect(code);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "connect_failed")}`);
  }
  await syncProvider("google", "connect");
  return back("connected=google");
}
