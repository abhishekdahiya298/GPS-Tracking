import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { POST as redeemPOST } from "@/app/api/driver-app/invite/route";
import { POST as answerPOST } from "@/app/api/driver-app/loads/[id]/route";
import { GET as requestsGET } from "@/app/api/driver-app/requests/route";
import { POST as reportPOST } from "@/app/api/driver-app/report/route";

/**
 * A driver's phone in tests (driver-first: loads go to the RIO GPS app). Signs in with the app link
 * a load returned, answers loads and sends positions the way the app does.
 */
const BASE = "http://localhost:3000";
let ip = 1;
export function driverPhone() {
  let bearer = "";
  const call = (method: string, path: string, body?: unknown) =>
    new Request(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "x-forwarded-for": `192.0.2.${(ip++ % 250) + 1}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    get signedIn() {
      return bearer !== "";
    },
    /** Signs in with a one-tap app link (/driver-app?t=…). */
    async signIn(link: string) {
      const t = new URL(link).searchParams.get("t");
      if (!t) throw new Error(`Not a sign-in link: ${link}`);
      const res = await redeemPOST(call("POST", "/api/driver-app/invite", { token: t, device: { platform: "android", appVersion: "2.3.0" } }));
      if (res.status !== 201) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
      bearer = ((await res.json()) as { token: string }).token;
    },
    async requests() {
      return (await (await requestsGET(call("GET", "/api/driver-app/requests"))).json()) as { loads: { id: string; reference: string; from: { name: string } }[] };
    },
    answer(loadId: string, action: "accept" | "decline" | "stop" | "resume") {
      return answerPOST(call("POST", `/api/driver-app/loads/${loadId}`, { action }), { params: Promise.resolve({ id: loadId }) });
    },
    /** Sends positions; returns how many the load took and its status after. */
    async positions(loadId: string, list: { latitude: number; longitude: number; at: string; accuracyM?: number }[]) {
      const res = await reportPOST(call("POST", "/api/driver-app/report", { points: list.map((x) => ({ latitude: x.latitude, longitude: x.longitude, accuracyM: x.accuracyM ?? 15, recordedAt: x.at })), permission: "always", locationEnabled: true }));
      if (res.status >= 300) throw new Error(`report failed: ${res.status} ${await res.text()}`);
      const { stored } = (await res.json()) as { stored: number };
      const [row] = await getDb().select({ status: schema.loads.status }).from(schema.loads).where(eq(schema.loads.id, loadId));
      return { accepted: stored, status: row?.status ?? null };
    }
  };
}
