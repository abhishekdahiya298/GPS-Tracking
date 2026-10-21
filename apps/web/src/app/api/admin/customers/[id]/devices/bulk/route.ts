import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { BulkRegisterSchema, registerDevicesBulk } from "@/lib/customers";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
// Up to 200 trackers, each a Traccar call: allow time for a full batch.
export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };

/** Registers many devices (by IMEI) for one customer in Traccar and RIO; a status per IMEI. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Customer not found");
    const out = await registerDevicesBulk(user.userId, id, parseOrThrow(BulkRegisterSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(out);
  } catch (err) {
    return errorResponse(err, { route: "admin.devices.bulk_register" });
  }
}
