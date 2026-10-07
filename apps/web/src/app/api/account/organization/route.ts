import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { listMyOrganizations, switchOrganization } from "@/lib/my-organizations";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const Body = z.object({ organizationId: z.string().uuid() });

/** The companies the signed-in person belongs to. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    return NextResponse.json({ organizations: await listMyOrganizations(user.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, { route: "account.organizations" });
  }
}

/** POST { organizationId }: work in another company you are a member of. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const { organizationId } = parseOrThrow(Body, await readJson(request));
    await switchOrganization(user, organizationId, requestMeta(request));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return errorResponse(err, { route: "account.organization.switch" });
  }
}
