import { NextResponse } from "next/server";
import { z } from "zod";
import { DeviceInfoSchema, verifyDriverPhoneSignIn } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../../_shared";

export const dynamic = "force-dynamic";
const Body = z.object({ phone: z.string().max(40), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"), device: DeviceInfoSchema.default({}) });

/** POST (driver app): { phone, code } → a driver app sign-in. */
export async function POST(request: Request) {
  try {
    const body = parseOrThrow(Body, await readJson(request));
    return NextResponse.json(await verifyDriverPhoneSignIn(body.phone, body.code, body.device), { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.phone_verify" });
  }
}
