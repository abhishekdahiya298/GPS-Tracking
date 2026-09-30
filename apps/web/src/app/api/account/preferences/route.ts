import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { getUserPrefs, updateUserPrefs, UserPrefsPatchSchema } from "@/lib/organization";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** The signed-in user's own display preferences (time zone, clock). null = organization default. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json(await getUserPrefs(user.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "account.preferences.get" });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const patch = parseOrThrow(UserPrefsPatchSchema, await readJson(request));
    await updateUserPrefs(user.userId, user.activeOrganizationId, patch, requestMeta(request));
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    return errorResponse(err, { route: "account.preferences.update" });
  }
}
