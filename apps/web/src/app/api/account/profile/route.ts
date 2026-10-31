import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { renameSelf, RenameSchema } from "@/lib/team";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** PATCH { name } — the signed-in person changes the spelling of their own name. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const { name } = parseOrThrow(RenameSchema, await readJson(request));
    await renameSelf(user.userId, user.activeOrganizationId, name, requestMeta(request));
    return NextResponse.json({ status: "updated", name }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "account.profile.update" });
  }
}
