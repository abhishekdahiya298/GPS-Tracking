import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { DriverJoinSchema, startDriverJoin } from "@/lib/signup";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/signup/join (public): a driver joins their company with its code. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const result = await startDriverJoin(parseOrThrow(DriverJoinSchema, await readJson(request)), requestMeta(request).ipAddress);
    return NextResponse.json(result, { status: result.status === "joined" ? 201 : 202 });
  } catch (err) {
    return errorResponse(err, { route: "signup.join" });
  }
}
