import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { FeatureRulesSchema, setFeatureRules } from "@/lib/entitlements";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT: for each feature, what customers without it see (lock or hide). Platform admins only. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    await setFeatureRules(user.userId, parseOrThrow(FeatureRulesSchema, await readJson(request)), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "admin.feature_rules.put" });
  }
}
