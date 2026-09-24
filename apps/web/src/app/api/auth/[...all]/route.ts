import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Better Auth endpoints: /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/get-session, ...
// (sign-up is disabled in the auth config; accounts are created by administrators).
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
