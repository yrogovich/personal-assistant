import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Handler is built per request so `next build` doesn't need secrets.
export const GET = (req: Request) => toNextJsHandler(auth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(auth()).POST(req);
