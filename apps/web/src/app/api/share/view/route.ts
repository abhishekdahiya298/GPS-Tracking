import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { assertShareViewRate, viewShareLink } from "@/lib/share-links";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

/**
 * PUBLIC (no session): the current position of the one vehicle a share link points at.
 * POST with { token } so the token never appears in a URL (server logs, Referer).
 * Unknown, malformed, expired and revoked tokens all return the same 404.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertShareViewRate(requestMeta(request).ipAddress);
    const body = (await readJson(request)) as { token?: unknown } | null;
    const view = typeof body?.token === "string" ? await viewShareLink(body.token) : null;
    if (!view) return NextResponse.json({ error: { code: "NOT_AVAILABLE", message: "This link is not available." } }, { status: 404, headers: HEADERS });
    return NextResponse.json(view, { headers: HEADERS });
  } catch (err) {
    return errorResponse(err, { route: "share.view" });
  }
}
