import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDriver } from "@/lib/driver-app";
import { answerLoad, driverLoadRequests, LoadAnswerSchema } from "@/lib/driver-loads";
import { driverLoads } from "@/lib/driver-app";
import { errorResponse, NotFoundError } from "@/lib/errors";
import { readJson } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";
import { NO_STORE } from "../../_shared";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** POST {action: accept|decline|stop|resume} (driver app, Bearer): answer a load sent to the driver's number. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await authenticateDriver(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("That load isn't yours");
    const { action } = parseOrThrow(LoadAnswerSchema, await readJson(request));
    await answerLoad(auth, id, action);
    const [loads, requests] = await Promise.all([driverLoads(auth), driverLoadRequests(auth)]);
    return NextResponse.json({ loads, requests }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err, { route: "driver_app.load_answer" });
  }
}
