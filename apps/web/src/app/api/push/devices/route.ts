import { NextResponse } from "next/server";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { listPushDevices, PushDeviceInputSchema, PushDeviceRemoveSchema, registerPushDevice, removePushDevice } from "@/lib/push";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store" };

/** The caller's own registered phones in the current organization. */
export async function GET(request: Request) {
  try {
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.read");
    return NextResponse.json({ devices: await listPushDevices(ctx) }, { headers: HEADERS });
  } catch (err) {
    return errorResponse(err, { route: "push.devices.list" });
  }
}

/** Register this phone for alert pushes, or change which kinds it gets. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    requirePermission(ctx, "alerts.read");
    const device = await registerPushDevice(ctx, parseOrThrow(PushDeviceInputSchema, await readJson(request)));
    return NextResponse.json({ device }, { status: 201, headers: HEADERS });
  } catch (err) {
    return errorResponse(err, { route: "push.devices.register" });
  }
}

/** Stop pushes to this phone (called on sign-out). Only the caller's own registration is removed. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenantContext(request);
    const removed = await removePushDevice(ctx, parseOrThrow(PushDeviceRemoveSchema, await readJson(request)).token);
    return NextResponse.json({ removed }, { headers: HEADERS });
  } catch (err) {
    return errorResponse(err, { route: "push.devices.remove" });
  }
}
