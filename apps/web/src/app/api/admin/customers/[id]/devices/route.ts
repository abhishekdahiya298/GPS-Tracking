import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-guard";
import { assertSameOrigin } from "@/lib/csrf";
import { registerDevice, RegisterDeviceSchema } from "@/lib/customers";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Registers a device (by IMEI) for a customer in Traccar and RIO. */
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSuperAdmin(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Customer not found");
    const out = await registerDevice(user.userId, id, parseOrThrow(RegisterDeviceSchema, await readJson(request)), requestMeta(request));
    return NextResponse.json(out, { status: 201 });
  } catch (err) {
    return errorResponse(err, { route: "admin.devices.register" });
  }
}
