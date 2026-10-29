import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { stravaAuthUrl } from "@/server/integrations/strava";

export async function GET() {
  await requireUser();
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/connect/strava",
    maxAge: 600,
  });
  return NextResponse.redirect(stravaAuthUrl(state));
}
