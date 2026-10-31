import { NextResponse } from "next/server";
import { requireAuthenticatedUser, resolveTenantContext } from "@/lib/authz";
import { errorResponse, PlatformOnlyError } from "@/lib/errors";
import { globalSearch, searchCustomers, SearchQuery } from "@/lib/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q= — command palette. Each group is permission-checked and org-scoped; ≤ 5 hits per group. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    // A platform admin with no customer open searches customers only.
    const ctx = await resolveTenantContext(user).catch((err) => {
      if (err instanceof PlatformOnlyError) return null;
      throw err;
    });
    const parsed = SearchQuery.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
    if (!parsed.success) return NextResponse.json({ hits: [] }, { headers: { "Cache-Control": "no-store" } });
    const hits = ctx ? await globalSearch(ctx, parsed.data.q) : await searchCustomers(parsed.data.q);
    return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "search" });
  }
}
