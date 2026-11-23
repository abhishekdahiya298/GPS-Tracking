import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { resendCode } from "@/lib/signup";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/signup/resend (public): another text code for a sign-up in progress. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { token } = parseOrThrow(z.object({ token: z.string().min(16).max(64) }), await readJson(request));
    return NextResponse.json(await resendCode(token));
  } catch (err) {
    return errorResponse(err, { route: "signup.resend" });
  }
}
