import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDriver } from "@/lib/driver-app";
import { RespondSchema, respondToRequest } from "@/lib/driver-links";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../../_shared";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST {accept} (driver app, Bearer): yes or no to a company that added the driver's number. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await authenticateDriver(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("That request isn't open");
    const { accept } = parseOrThrow(RespondSchema, await readJson(request));
    return NextResponse.json(await respondToRequest(auth, id, accept), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.respond" });
  }
}
