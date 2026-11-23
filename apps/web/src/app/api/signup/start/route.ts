import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { CompanySignupSchema, startCompanySignup } from "@/lib/signup";
import { signedInResponse } from "@/lib/signup-session";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/signup/start (public): company details → a text code, or the company right away when codes are off. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = parseOrThrow(CompanySignupSchema, await readJson(request));
    const result = await startCompanySignup(input, requestMeta(request).ipAddress);
    if (result.status === "created") return signedInResponse(request, input.email, input.password, result);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err, { route: "signup.start" });
  }
}
