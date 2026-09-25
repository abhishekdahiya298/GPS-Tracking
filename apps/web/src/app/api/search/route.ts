import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/authz";
import { errorResponse } from "@/lib/errors";
import { globalSearch, SearchQuery } from "@/lib/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q= — command palette. Each group is permission-checked and org-scoped; ≤ 5 hits per group. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    const parsed = SearchQuery.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
    if (!parsed.success) return NextResponse.json({ hits: [] }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ hits: await globalSearch(ctx, parsed.data.q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "search" });
  }
}
