import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { viewAsShipper } from "@/lib/load-public";
import { assertRateLimit } from "@/lib/rate-limit";
import { readJson, requestMeta } from "@/lib/request-meta";
import { notAvailable, PUBLIC_HEADERS } from "../../driver/_shared";

export const dynamic = "force-dynamic";

/** PUBLIC: the shipper's read-only view of one load, { token }. */
export async function POST(request: Request) {
  try {
    await assertRateLimit("track", requestMeta(request).ipAddress ?? "unknown", 120, 60, "Too many requests. Try again in a minute.");
    const body = (await readJson(request)) as { token?: unknown } | null;
    const view = typeof body?.token === "string" ? await viewAsShipper(body.token) : null;
    return view ? NextResponse.json(view, { headers: PUBLIC_HEADERS }) : notAvailable();
  } catch (err) {
    return errorResponse(err, { route: "track.view" });
  }
}
