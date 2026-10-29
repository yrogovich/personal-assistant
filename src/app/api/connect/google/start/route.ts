import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { googleAuthUrl } from "@/server/integrations/google/oauth";

export async function GET() {
  await requireUser();
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/connect/google",
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthUrl(state));
}
