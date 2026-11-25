import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { createDriverInvite } from "@/lib/driver-app";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { sendSms, smsConfigured } from "@/lib/sms";
import { getDb, schema } from "@rio-gps/db";
import { and, eq } from "drizzle-orm";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST { text?: boolean }: a personal driver app link for this driver; texts it when asked and possible. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.create");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
    const body = parseOrThrow(z.object({ text: z.boolean().default(false) }), (await readJson(request).catch(() => ({}))) ?? {});
    const invite = await createDriverInvite(ctx, id, ctx.userId);
    let texted = false;
    if (body.text && smsConfigured()) {
      const [d] = await getDb().select({ phone: schema.drivers.phone, org: schema.organizations.name }).from(schema.drivers).innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId)).where(and(eq(schema.drivers.id, id), eq(schema.drivers.organizationId, ctx.organizationId)));
      if (d?.phone) texted = (await sendSms(d.phone, `${d.org} invited you to the RIO GPS driver app. Open this link on your phone to sign in: ${invite.url}`)).sent;
    }
    return NextResponse.json({ invite, texted, smsReady: smsConfigured() }, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "drivers.app_invite" });
  }
}
