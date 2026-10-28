import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { runLoadChecks } from "@/lib/load-tracking";
import { setPushTransportForTests } from "@/lib/push";
import { POST as createPOST } from "@/app/api/loads/route";
import { GET as loadGET, PATCH as loadPATCH } from "@/app/api/loads/[id]/route";
import { POST as driverLinkPOST } from "@/app/api/loads/[id]/driver-link/route";
import { POST as driverViewPOST } from "@/app/api/driver/view/route";
import { POST as driverActionPOST } from "@/app/api/driver/action/route";
import { POST as driverPosPOST } from "@/app/api/driver/positions/route";
import { POST as webhookPOST } from "@/app/api/webhooks/traccar/route";
import { POST as pushRegisterPOST } from "@/app/api/push/devices/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "350000000000111";
const IMEI_B = "350000000000222";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA: string, vehA: string, vehNoTracker: string, vehB: string;
let outbox: EmailMessage[] = [];
let pushed: { title: string; body: string }[] = [];

// Toronto → Montreal.
const PICKUP = { name: null, address: "100 Front Street West, Toronto, ON M5J 1E3, Canada", latitude: 43.6453, longitude: -79.3806, radiusM: 500, appointmentAt: null };
const DELIVERY = { name: "Port DC", address: "1 Rue Notre-Dame, Montréal, QC H2Y 1B5, Canada", latitude: 45.5048, longitude: -73.5566, radiusM: 500, appointmentAt: null };
const north = (s: { latitude: number; longitude: number }, m: number) => ({ latitude: s.latitude + m / 111_195, longitude: s.longitude });

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.8.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pub = (path: string, body: unknown) => new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.114.${ipN++}` }, body: JSON.stringify(body) });

let fixTime = Date.now() - 60 * 60_000;
/** A real Traccar-shaped position through the webhook. */
async function drive(imei: string, pos: { latitude: number; longitude: number }, kph = 80) {
  fixTime += 60_000;
  const res = await webhookPOST(
    new Request(`${BASE}/api/webhooks/traccar`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TRACCAR_WEBHOOK_SECRET}` },
      body: JSON.stringify({ position: { id: 1, deviceId: 1, fixTime: new Date(fixTime).toISOString(), valid: true, latitude: pos.latitude, longitude: pos.longitude, speed: kph / 1.852, course: 0, attributes: { ignition: true } }, device: { id: 1, uniqueId: imei } })
    })
  );
  expect(res.status).toBe(200);
}
const alertsOf = async (loadId: string) =>
  (await getDb().select().from(schema.alertEvents).where(eq(schema.alertEvents.organizationId, orgA)).orderBy(schema.alertEvents.id)).filter((e) => (e.details as { loadId?: string } | null)?.loadId === loadId);
async function create(body: Record<string, unknown>) {
  const res = await createPOST(req("POST", "/api/loads", "dispatch", body));
  return { status: res.status, json: (await res.json()) as { id: string; driverLink: string | null; error?: { message: string } } };
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  orgA = (await db.insert(schema.organizations).values({ name: "Fleet Broker A", slug: "fba" }).returning())[0]!.id;
  const orgB = (await db.insert(schema.organizations).values({ name: "Other", slug: "other" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI, imei: IMEI }).returning())[0]!.id;
  const devB = (await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb.id, externalDeviceId: IMEI_B, imei: IMEI_B }).returning())[0]!.id;
  vehA = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Truck 12" }).returning())[0]!.id;
  vehNoTracker = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Spare" }).returning())[0]!.id;
  vehB = (await db.insert(schema.vehicles).values({ organizationId: orgB, name: "B truck" }).returning())[0]!.id;
  await db.insert(schema.deviceAssignments).values([
    { organizationId: orgA, deviceId: devA, vehicleId: vehA },
    { organizationId: orgB, deviceId: devB, vehicleId: vehB }
  ]);
  for (const [who, slug, role] of [["dispatch", "fba", "DISPATCHER"], ["admin", "fba", "ORG_ADMIN"]] as const) {
    await createUserWithMembership({ email: `${who}@fba.test`, name: who, password: PASSWORD, organizationSlug: slug, role });
    cookies[who] = await signIn(`${who}@fba.test`);
  }
  setEmailTransportForTests(async (m) => {
    outbox.push(m);
  });
  setPushTransportForTests(async (messages) => {
    pushed.push(...messages.map((m) => ({ title: m.title, body: m.body })));
    return messages.map(() => ({ ok: true }));
  });
  // The dispatcher's phone wants load alerts.
  const reg = await pushRegisterPOST(req("POST", "/api/push/devices", "dispatch", { token: "ExponentPushToken[abcdefghijklmnop]", platform: "android" }));
  expect(reg.status).toBeLessThan(300);
  // The truck is parked near the pickup before the load is created.
  await drive(IMEI, north(PICKUP, 8_000), 0);
});
beforeEach(() => {
  outbox = [];
  pushed = [];
});
afterAll(async () => {
  setEmailTransportForTests(null);
  setPushTransportForTests(null);
  await closeDb();
});

describe("loads tracked by the organization's own tracker", () => {
  let id: string;

  it("needs a vehicle of the same organization; a phone number is optional", async () => {
    const missing = await create({ reference: "V-1", trackingMode: "vehicle", pickup: PICKUP, delivery: DELIVERY });
    expect(missing.status).toBe(400);
    const foreign = await create({ reference: "V-1", trackingMode: "vehicle", vehicleId: vehB, pickup: PICKUP, delivery: DELIVERY });
    expect(foreign.status).toBe(400);
    const phoneMissing = await create({ reference: "P-1", pickup: PICKUP, delivery: DELIVERY });
    expect(phoneMissing.status).toBe(400);
  });

  it("starts tracking at once from the tracker's current position, with no driver link", async () => {
    const { status, json } = await create({ reference: "V-100", trackingMode: "vehicle", vehicleId: vehA, driverName: "Raj", pickup: PICKUP, delivery: DELIVERY });
    expect(status).toBe(201);
    expect(json.driverLink).toBeNull();
    id = json.id;
    const d = (await (await loadGET(req("GET", `/api/loads/${id}`, "dispatch"), p(id))).json()) as { status: string; trackingMode: string; vehicle: { name: string }; lastPosition: unknown; eta: { target: string } | null };
    expect(d).toMatchObject({ status: "tracking", trackingMode: "vehicle", vehicle: { name: "Truck 12" } });
    expect(d.lastPosition).not.toBeNull();
    expect(d.eta?.target).toBe("pickup");
    // No driver link exists for it.
    expect((await driverLinkPOST(req("POST", `/api/loads/${id}/driver-link`, "dispatch", {}), p(id))).status).toBe(400);
  });

  it("tracker positions from the webhook move the status and raise arrival alerts", async () => {
    fixTime = Date.now();
    await drive(IMEI, north(PICKUP, 100), 0);
    let d = (await (await loadGET(req("GET", `/api/loads/${id}`, "dispatch"), p(id))).json()) as { status: string; trail: unknown[] };
    expect(d.status).toBe("at_pickup");
    await drive(IMEI, north(PICKUP, 5_000));
    await drive(IMEI, north(DELIVERY, 50), 0);
    d = (await (await loadGET(req("GET", `/api/loads/${id}`, "dispatch"), p(id))).json()) as { status: string; trail: unknown[] };
    expect(d.status).toBe("at_delivery");
    // The trail is the vehicle's own track while the load ran.
    expect(d.trail.length).toBeGreaterThanOrEqual(3);
    const a = await alertsOf(id);
    expect(a.map((e) => e.type)).toEqual(["load_arrived", "load_arrived"]);
    expect(a[0]!.ruleName).toBe("Load V-100");
    expect(a[0]!.details).toMatchObject({ reference: "V-100", stop: "pickup" });
    // Arrivals are pushed, not emailed.
    expect(pushed.some((m) => m.title === "Load V-100 arrived")).toBe(true);
    expect(outbox).toHaveLength(0);
  });

  it("leaving the delivery delivers it and the tracker no longer moves it", async () => {
    await drive(IMEI, north(DELIVERY, 3_000));
    const d = (await (await loadGET(req("GET", `/api/loads/${id}`, "dispatch"), p(id))).json()) as { status: string };
    expect(d.status).toBe("delivered");
    expect((await alertsOf(id)).at(-1)?.type).toBe("load_delivered");
    const before = (await getDb().select().from(schema.loads).where(eq(schema.loads.id, id)))[0]!.lastPositionAt;
    await drive(IMEI, north(PICKUP, 0));
    const after = (await getDb().select().from(schema.loads).where(eq(schema.loads.id, id)))[0]!;
    expect(after.status).toBe("delivered");
    expect(after.lastPositionAt).toEqual(before);
  });

  it("can switch to another vehicle; a phone load cannot take a vehicle", async () => {
    const { json } = await create({ reference: "V-101", trackingMode: "vehicle", vehicleId: vehA, pickup: PICKUP, delivery: DELIVERY });
    const r = await loadPATCH(req("PATCH", `/api/loads/${json.id}`, "dispatch", { vehicleId: vehNoTracker }), p(json.id));
    expect(((await r.json()) as { vehicle: { name: string } }).vehicle.name).toBe("Spare");
    const phone = await create({ reference: "P-101", driverPhone: "4165550101", pickup: PICKUP, delivery: DELIVERY });
    expect((await loadPATCH(req("PATCH", `/api/loads/${phone.json.id}`, "dispatch", { vehicleId: vehA }), p(phone.json.id))).status).toBe(400);
  });
});

describe("load alerts", () => {
  it("driver pausing is alerted and emailed to the team", async () => {
    const { json } = await create({ reference: "P-200", driverPhone: "4165550102", pickup: PICKUP, delivery: DELIVERY });
    const token = json.driverLink!.split("#")[1]!;
    expect((await driverViewPOST(pub("/api/driver/view", { token }))).status).toBe(200);
    await driverActionPOST(pub("/api/driver/action", { token, action: "accept" }));
    await driverActionPOST(pub("/api/driver/action", { token, action: "stop" }));
    const a = await alertsOf(json.id);
    expect(a.map((e) => e.type)).toEqual(["load_paused"]);
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[0]!.subject).toBe("RIO GPS alert: Load P-200 driver paused location sharing");
    expect(outbox[0]!.text).toContain(`/loads/${json.id}`);
  });

  it("no signal is raised once, and again only after a new position", async () => {
    const { json } = await create({ reference: "P-201", driverPhone: "4165550103", pickup: PICKUP, delivery: DELIVERY });
    const token = json.driverLink!.split("#")[1]!;
    await driverActionPOST(pub("/api/driver/action", { token, action: "accept" }));
    // Accepted 40 minutes ago with no position since.
    await getDb().update(schema.loads).set({ acceptedAt: new Date(Date.now() - 40 * 60_000) }).where(eq(schema.loads.id, json.id));
    await runLoadChecks();
    await runLoadChecks();
    expect((await alertsOf(json.id)).filter((e) => e.type === "load_no_signal")).toHaveLength(1);
    // A new position clears it; a later silence raises it again.
    await driverPosPOST(pub("/api/driver/positions", { token, positions: [{ latitude: 43.7, longitude: -79.4, accuracyM: 10, recordedAt: new Date().toISOString() }] }));
    expect((await getDb().select().from(schema.loads).where(eq(schema.loads.id, json.id)))[0]!.staleAlertedAt).toBeNull();
    await runLoadChecks(new Date(Date.now() + 31 * 60_000));
    expect((await alertsOf(json.id)).filter((e) => e.type === "load_no_signal")).toHaveLength(2);
  });

  it("running late is raised once per stop", async () => {
    const lateDelivery = { ...DELIVERY, appointmentAt: new Date(Date.now() + 60 * 60_000).toISOString() }; // Montreal in 1 hour from Toronto: late
    const { json } = await create({ reference: "V-300", trackingMode: "vehicle", vehicleId: vehA, pickup: PICKUP, delivery: lateDelivery });
    await drive(IMEI, north(PICKUP, 0), 0);
    await drive(IMEI, north(PICKUP, 5_000));
    expect((await getDb().select().from(schema.loads).where(eq(schema.loads.id, json.id)))[0]!.status).toBe("in_transit");
    await runLoadChecks();
    await runLoadChecks();
    const late = (await alertsOf(json.id)).filter((e) => e.type === "load_late");
    expect(late).toHaveLength(1);
    expect(late[0]!.details).toMatchObject({ target: "delivery", reference: "V-300" });
    expect(outbox.some((m) => m.subject === "RIO GPS alert: Load V-300 is running late")).toBe(true);
  });

  it("load alerts show in the organization's alerts only", async () => {
    const n = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.alertEvents).where(and(eq(schema.alertEvents.type, "load_arrived"), sql`${schema.alertEvents.organizationId} <> ${orgA}`));
    expect(n[0]!.n).toBe(0);
  });
});
