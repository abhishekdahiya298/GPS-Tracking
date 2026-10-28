import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { viewAsDriver } from "@/lib/load-public";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson, requestMeta } from "@/lib/request-meta";
import { notAvailable, PUBLIC_HEADERS } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * PUBLIC (no session; the driver link's token is the credential, sent in the body so it is
 * never in a URL). No cookies are read, so there is nothing for CSRF to forge.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit("driver", requestMeta(request).ipAddress ?? "unknown", 120, 60, "Too many requests. Try again in a minute.");
    const body = (await readJson(request)) as { token?: unknown } | null;
    const view = typeof body?.token === "string" ? await viewAsDriver(body.token) : null;
    return view ? NextResponse.json(view, { headers: PUBLIC_HEADERS }) : notAvailable();
  } catch (err) {
    return errorResponse(err, { route: "driver.view" });
  }
}
