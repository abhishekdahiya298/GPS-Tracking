import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDriver } from "@/lib/driver-app";
import { leaveCompany } from "@/lib/driver-links";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { NO_STORE } from "../../../_shared";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST (driver app, Bearer): stop working with a company; it stops seeing the driver's location. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await authenticateDriver(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("That company isn't in your list");
    return NextResponse.json(await leaveCompany(auth, id), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.leave" });
  }
}
