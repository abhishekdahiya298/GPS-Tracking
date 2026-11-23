import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { SignupAndUpgradeSchema, setSignupAndUpgrade } from "@/lib/entitlements";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PUT: who can sign up, their starting plan, protection and the upgrade contact. Platform admins only. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    await setSignupAndUpgrade(user.userId, parseOrThrow(SignupAndUpgradeSchema, await readJson(request)), requestMeta(request));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, { route: "admin.signup_settings.put" });
  }
}
