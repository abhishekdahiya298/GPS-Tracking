import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { driverAction, DriverActionSchema } from "@/lib/load-public";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { notAvailable, PUBLIC_HEADERS } from "../_shared";

export const dynamic = "force-dynamic";

/** PUBLIC: { token, action: "accept" | "decline" | "stop" } from the driver page. */
export async function POST(request: Request) {
  try {
    const meta = requestMeta(request);
    await assertRateLimit("driver", meta.ipAddress ?? "unknown", 120, 60, "Too many requests. Try again in a minute.");
    const body = parseOrThrow(DriverActionSchema, await readJson(request));
    const view = await driverAction(body.token, body.action, meta);
    return view ? NextResponse.json(view, { headers: PUBLIC_HEADERS }) : notAvailable();
  } catch (err) {
    return errorResponse(err, { route: "driver.action" });
  }
}
