import { NextResponse } from "next/server";
import { z } from "zod";
import { startDriverPhoneSignIn } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../../_shared";

export const dynamic = "force-dynamic";

/** POST (driver app): { phone } → a code by text, or by email until texts work, when the number is an active driver's. */
export async function POST(request: Request) {
  try {
    const body = parseOrThrow(z.object({ phone: z.string().max(40) }), await readJson(request));
    return NextResponse.json(await startDriverPhoneSignIn(body.phone, requestMeta(request).ipAddress), { status: 202, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.phone_start" });
  }
}
