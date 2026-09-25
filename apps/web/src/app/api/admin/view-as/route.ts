import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { setViewAs } from "@/lib/customers";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const Body = z.object({ organizationId: z.string().uuid().nullable() });

/** POST { organizationId } to view the app as that customer; { organizationId: null } to return. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const { organizationId } = parseOrThrow(Body, await readJson(request));
    await setViewAs(user.userId, user.sessionId, organizationId, requestMeta(request));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return errorResponse(err, { route: "admin.view_as" });
  }
}
