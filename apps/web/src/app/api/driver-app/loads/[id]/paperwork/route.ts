import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDriver, driverLoads } from "@/lib/driver-app";
import { errorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { addLoadDocument, loadPaperwork } from "@/lib/paperwork";
import { assertRateLimit } from "@/lib/rate-limit";
import { readUpload } from "@/lib/upload";
import { NO_STORE } from "../../../_shared";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** The driver may only see and add paperwork for loads that are theirs in the app. */
async function myLoad(request: Request, id: string) {
  const auth = await authenticateDriver(request);
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("That load isn't yours");
  const load = (await driverLoads(auth)).find((l) => l.id === id);
  if (!load) throw new NotFoundError("That load isn't yours");
  return { auth, organizationId: load.from.id };
}

/** GET (driver app): what to send for this load, what's already in, what's missing. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await myLoad(request, (await params).id);
    const pw = await loadPaperwork(organizationId, (await params).id);
    // The driver sees the list and their counts, not who on the team uploaded what.
    return NextResponse.json({ items: pw.items.map((i) => ({ key: i.key, stop: i.stop, label: i.label, kind: i.kind, mode: i.mode, due: i.due, missing: i.missing, count: i.docs.length, last: i.docs.at(-1)?.at ?? null })), missing: pw.missing }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.paperwork" });
  }
}

/** POST multipart {file, itemKey, method, lat, lon, capturedAt} (driver app): a scan, photo or file. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { auth, organizationId } = await myLoad(request, id);
    await assertRateLimit("paperwork_upload", auth.driverId, 120, 3600, "Too many uploads. Try again in a while.");
    const up = await readUpload(request);
    if (!up.itemKey) throw new ValidationError("Choose what this file is");
    const num = (v: string | undefined, lo: number, hi: number) => {
      const n = v === undefined || v === "" ? NaN : Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
    };
    const at = up.fields.capturedAt ? new Date(up.fields.capturedAt) : null;
    const method = ["scan", "camera", "upload"].includes(up.fields.method ?? "") ? (up.fields.method as "scan" | "camera" | "upload") : "upload";
    await addLoadDocument({
      organizationId,
      loadId: id,
      itemKey: up.itemKey,
      data: up.data,
      fileName: up.fileName,
      method,
      latitude: num(up.fields.lat, -90, 90),
      longitude: num(up.fields.lon, -180, 180),
      capturedAt: at && !Number.isNaN(at.getTime()) && at.getTime() < Date.now() + 120_000 ? at : null,
      driverId: auth.driverId
    });
    const pw = await loadPaperwork(organizationId, id);
    return NextResponse.json({ items: pw.items.map((i) => ({ key: i.key, stop: i.stop, label: i.label, kind: i.kind, mode: i.mode, due: i.due, missing: i.missing, count: i.docs.length, last: i.docs.at(-1)?.at ?? null })), missing: pw.missing }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.paperwork_upload" });
  }
}
