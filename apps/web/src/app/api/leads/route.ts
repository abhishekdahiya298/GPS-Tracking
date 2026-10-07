import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { assertLeadRate, createLead } from "@/lib/leads";
import { readJson, requestMeta } from "@/lib/request-meta";
import { LeadInputSchema } from "@/lib/schemas/lead";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/**
 * PUBLIC (no session): a "Get pricing" request from the marketing site.
 * Same-origin only, rate-limited per address, validated; the response never says
 * whether a submission was dropped as spam.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertLeadRate(requestMeta(request).ipAddress);
    await createLead(parseOrThrow(LeadInputSchema, await readJson(request)));
    return NextResponse.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "leads.create" });
  }
}
