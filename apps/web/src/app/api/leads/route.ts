import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { assertLeadRate, createLead } from "@/lib/leads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { LeadInputSchema } from "@/lib/schemas/lead";
import { publicSiteOrigins } from "@/lib/site-origins";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** CORS headers for the public marketing site only (never credentials). Empty for any other origin. */
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !publicSiteOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

/** Preflight from the marketing site. Other origins get no CORS headers, so browsers block them. */
export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

/**
 * PUBLIC (no session): a "Get pricing" request from the marketing site.
 * Accepted from this app's own origin or a listed marketing-site origin, rate-limited per
 * address, validated; the response never says whether a submission was dropped as spam.
 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", ...cors(request) };
  try {
    const origin = request.headers.get("origin");
    if (!(origin && publicSiteOrigins().includes(origin))) assertSameOrigin(request);
    await assertLeadRate(requestMeta(request).ipAddress);
    await createLead(parseOrThrow(LeadInputSchema, await readJson(request)));
    return NextResponse.json({ ok: true }, { status: 201, headers });
  } catch (err) {
    const res = errorResponse(err, { route: "leads.create" });
    for (const [k, v] of Object.entries(cors(request))) res.headers.set(k, v);
    return res;
  }
}
