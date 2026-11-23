import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson, requestMeta } from "@/lib/request-meta";
import { verifySignup, VerifySchema } from "@/lib/signup";
import { signedInResponse } from "@/lib/signup-session";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/signup/verify (public): the text code → the company is created and the owner signed in (or the driver added). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit("signup-verify", requestMeta(request).ipAddress ?? "unknown", 30, 3600, "Too many tries. Try again later.");
    const input = parseOrThrow(VerifySchema, await readJson(request));
    const result = await verifySignup(input);
    if (result.status === "created") return signedInResponse(request, result.email, input.password!, result);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "signup.verify" });
  }
}
