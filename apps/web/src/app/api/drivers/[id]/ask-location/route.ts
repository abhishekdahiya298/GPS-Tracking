import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { askDriverLocation, AskLocationSchema } from "@/lib/driver-app";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST {message?}: push "turn on location" to the driver's phone. Once every 15 minutes. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "vehicles.update");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Driver not found");
    const input = parseOrThrow(AskLocationSchema, await readJson(request).catch(() => ({})));
    const [me] = await getDb().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.userId));
    const firstName = (me?.name ?? "").trim().split(/\s+/)[0] || "Dispatch";
    return NextResponse.json(await askDriverLocation(ctx, id, { userId: ctx.userId, name: firstName }, input.message));
  } catch (err) {
    return errorResponse(err, { route: "drivers.ask_location" });
  }
}
