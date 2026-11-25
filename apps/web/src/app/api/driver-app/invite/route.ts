import { NextResponse } from "next/server";
import { z } from "zod";
import { DeviceInfoSchema, redeemDriverInvite } from "@/lib/driver-app";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";
const Body = z.object({ token: z.string().min(16).max(100), device: DeviceInfoSchema.default({}) });

/** POST (driver app): the personal invite link's token → a driver app sign-in. */
export async function POST(request: Request) {
  try {
    const body = parseOrThrow(Body, await readJson(request));
    return NextResponse.json(await redeemDriverInvite(body.token, body.device, requestMeta(request).ipAddress), { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.invite" });
  }
}
