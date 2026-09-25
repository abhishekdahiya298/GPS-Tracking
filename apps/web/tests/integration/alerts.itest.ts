import "./setup-env";
import { alertChannel } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { runOfflineCheck } from "@/lib/alerts";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { POST as ackPOST } from "@/app/api/alerts/acknowledge/route";
import { GET as alertsGET } from "@/app/api/alerts/route";
import { POST as rulePOST } from "@/app/api/alert-rules/route";
import { DELETE as geofenceDELETE } from "@/app/api/geofences/[id]/route";
import { GET as geofencesGET, POST as geofencePOST } from "@/app/api/geofences/route";
import { POST as webhookPOST } from "@/app/api/webhooks/traccar/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI_A = "864361078566115";
const IMEI_A2 = "864361078566116";
const IMEI_B = "350000000000077";
const cookies: Record<string, string> = {};
let orgA: string, orgB: string, devA: string, devA2: string, vehA: string, vehA2: string;
let outbox: EmailMessage[] = [];
let sub: Redis;
const published: { channel: string; msg: string }[] = [];
let t0 = Date.parse("2026-09-25T10:00:00Z");
let ip = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `192.0.2.${100 + ip++}` },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Posts a real Traccar-shaped payload through the webhook (knots in, km/h stored). */
async function drive(imei: string, lat: number, lon: number, kph = 0, ignition: boolean | null = true) {
  t0 += 60_000;
  const res = await webhookPOST(
    new Request(`${BASE}/api/webhooks/traccar`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TRACCAR_WEBHOOK_SECRET}` },
      body: JSON.stringify({
        position: { id: 1, deviceId: 1, fixTime: new Date(t0).toISOString(), valid: true, latitude: lat, longitude: lon, speed: kph / 1.852, course: 0, attributes: ignition === null ? {} : { ignition } },
        device: { id: 1, uniqueId: imei }
      })
    })
  );
  expect(res.status).toBe(200);
}
const events = async (org: string) => getDb().select().from(schema.alertEvents).where(eq(schema.alertEvents.organizationId, org)).orderBy(schema.alertEvents.id);

// Depot polygon around (43.70, -79.70); home circle at (43.60,-79.60) r=500 m.
const DEPOT: [number, number][] = [[-79.71, 43.69], [-79.69, 43.69], [-79.69, 43.71], [-79.71, 43.71]];

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, verifications, memberships, users, organizations restart identity cascade`);
  orgA = (await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning())[0]!.id;
  orgB = (await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const dev = async (org: string, p: string, imei: string) => (await db.insert(schema.gpsDevices).values({ organizationId: org, providerId: p, externalDeviceId: imei, imei }).returning())[0]!.id;
  devA = await dev(orgA, pa.id, IMEI_A);
  devA2 = await dev(orgA, pa.id, IMEI_A2);
  await dev(orgB, pb.id, IMEI_B);
  vehA = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Range Rover" }).returning())[0]!.id;
  vehA2 = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Van" }).returning())[0]!.id;
  await db.insert(schema.deviceAssignments).values([
    { organizationId: orgA, deviceId: devA, vehicleId: vehA },
    { organizationId: orgA, deviceId: devA2, vehicleId: vehA2 }
  ]);
  for (const [who, slug, role] of [["admin", "org-a", "ORG_ADMIN"], ["dispatch", "org-a", "DISPATCHER"], ["viewer", "org-a", "VIEWER"], ["bob", "org-b", "ORG_ADMIN"]] as const) {
    await createUserWithMembership({ email: `${who}@x.test`, name: who, password: PASSWORD, organizationSlug: slug, role });
    cookies[who] = await signIn(`${who}@x.test`);
  }
  sub = new Redis(process.env.TEST_REDIS_URL!);
  sub.on("message", (channel, msg) => published.push({ channel, msg }));
  await sub.subscribe(alertChannel(orgA), alertChannel(orgB));
  setEmailTransportForTests(async (m) => {
    outbox.push(m);
  });
});
beforeEach(() => {
  outbox = [];
});
afterAll(async () => {
  setEmailTransportForTests(null);
  sub.disconnect();
  await closeDb();
});

let depotId: string;

describe("geofences API", () => {
  it("validates shapes, enforces RBAC and tenant scope", async () => {
    expect((await geofencePOST(req("POST", "/api/geofences", "viewer", { kind: "polygon", name: "x", ring: DEPOT }))).status).toBe(403);
    expect((await geofencePOST(req("POST", "/api/geofences", "admin", { kind: "polygon", name: "x", ring: DEPOT.slice(0, 2) }))).status).toBe(400);
    expect((await geofencePOST(req("POST", "/api/geofences", "admin", { kind: "circle", name: "x", center: [-79.6, 43.6], radiusM: 5 }))).status).toBe(400);
    expect((await geofencePOST(req("POST", "/api/geofences", "admin", { kind: "circle", name: "x", center: [-200, 43.6], radiusM: 500 }))).status).toBe(400);
    const res = await geofencePOST(req("POST", "/api/geofences", "admin", { kind: "polygon", name: "Depot", ring: DEPOT }));
    expect(res.status).toBe(201);
    depotId = (await res.json()).geofence.id;
    const bobFence = (await (await geofencePOST(req("POST", "/api/geofences", "bob", { kind: "circle", name: "B yard", center: [-79.6, 43.6], radiusM: 500 }))).json()).geofence.id;
    const list = await (await geofencesGET(req("GET", "/api/geofences", "viewer"))).json();
    expect(list.geofences.map((g: { name: string }) => g.name)).toEqual(["Depot"]);
    expect((await geofenceDELETE(req("DELETE", `/api/geofences/${bobFence}`, "admin"), { params: Promise.resolve({ id: bobFence }) })).status).toBe(404);
  });
});

describe("rules API", () => {
  it("requires type-specific params and same-org references", async () => {
    expect((await rulePOST(req("POST", "/api/alert-rules", "viewer", { name: "x", type: "speeding", speedKph: 100 }))).status).toBe(403);
    expect((await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "x", type: "speeding" }))).status).toBe(400);
    expect((await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "x", type: "geofence_enter" }))).status).toBe(400);
    const [bFence] = await getDb().select().from(schema.geofences).where(eq(schema.geofences.organizationId, orgB));
    expect((await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "x", type: "geofence_enter", geofenceId: bFence!.id }))).status).toBe(404);
  });
});

describe("evaluation through the real webhook", () => {
  it("geofence enter/exit fire on transitions only, published live and emailed (admins+dispatchers, not viewers)", async () => {
    await rulePOST(req("POST", "/api/alert-rules", "dispatch", { name: "Depot arrival", type: "geofence_enter", geofenceId: depotId, notifyEmail: true }));
    await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "Depot departure", type: "geofence_exit", geofenceId: depotId }));
    await drive(IMEI_A, 43.65, -79.65); // outside: initializes, no alert
    await drive(IMEI_A, 43.66, -79.66); // still outside
    expect(await events(orgA)).toHaveLength(0);
    await drive(IMEI_A, 43.70, -79.70); // enters
    await drive(IMEI_A, 43.701, -79.701); // still inside
    await drive(IMEI_A, 43.75, -79.75); // exits
    const ev = await events(orgA);
    expect(ev.map((e) => e.type)).toEqual(["geofence_enter", "geofence_exit"]);
    expect(ev[0]).toMatchObject({ vehicleId: vehA, deviceId: devA, ruleName: "Depot arrival" });
    expect(ev[0]!.details).toMatchObject({ geofence: "Depot" });
    await new Promise((r) => setTimeout(r, 150));
    expect(published.filter((p) => p.channel === alertChannel(orgA))).toHaveLength(2);
    expect(published.some((p) => p.channel === alertChannel(orgB))).toBe(false);
    expect(outbox.map((m) => m.to).sort()).toEqual(["admin@x.test", "dispatch@x.test"]);
    expect(outbox[0]!.subject).toContain("Range Rover");
  });

  it("speeding fires once per episode; email throttled per rule+device", async () => {
    await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "Speed 100", type: "speeding", speedKph: 100, notifyEmail: true }));
    for (const v of [90, 110, 120, 98, 101]) await drive(IMEI_A, 43.8, -79.8, v);
    let sp = (await events(orgA)).filter((e) => e.type === "speeding");
    expect(sp).toHaveLength(1);
    expect(sp[0]!.details).toMatchObject({ limitKph: 100 });
    await drive(IMEI_A, 43.8, -79.8, 80); // re-arm
    await drive(IMEI_A, 43.8, -79.8, 130); // second episode
    sp = (await events(orgA)).filter((e) => e.type === "speeding");
    expect(sp).toHaveLength(2);
    // First episode: one email per recipient (admin + dispatcher). Second episode within 5 min: throttled.
    expect(outbox.filter((m) => m.template === "alert_speeding").map((m) => m.to).sort()).toEqual(["admin@x.test", "dispatch@x.test"]);
  });

  it("vehicle-specific rules only apply to that vehicle; other orgs' rules never fire", async () => {
    await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "Van ignition", type: "ignition_on", vehicleId: vehA2 }));
    await rulePOST(req("POST", "/api/alert-rules", "bob", { name: "B speed", type: "speeding", speedKph: 10 }));
    await drive(IMEI_A, 43.8, -79.8, 0, false);
    await drive(IMEI_A, 43.8, -79.8, 0, true); // Range Rover: no van rule
    await drive(IMEI_A2, 43.8, -79.8, 0, false);
    await drive(IMEI_A2, 43.8, -79.8, 50, true); // Van: ignition on
    const ign = (await events(orgA)).filter((e) => e.type === "ignition_on");
    expect(ign).toHaveLength(1);
    expect(ign[0]!.deviceId).toBe(devA2);
    expect(await events(orgB)).toHaveLength(0);
  });

  it("a rule referencing a vehicle of another org cannot be created", async () => {
    expect((await rulePOST(req("POST", "/api/alert-rules", "bob", { name: "x", type: "ignition_on", vehicleId: vehA }))).status).toBe(404);
  });
});

describe("offline scheduler", () => {
  it("fires once per outage, re-arms on the next position, and is single-runner", async () => {
    await rulePOST(req("POST", "/api/alert-rules", "admin", { name: "Offline 60m", type: "device_offline", offlineMinutes: 60 }));
    await getDb().update(schema.gpsDevices).set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(schema.gpsDevices.id, devA));
    await getDb().update(schema.gpsDevices).set({ lastSeenAt: new Date() }).where(eq(schema.gpsDevices.id, devA2));
    const [a, b] = await Promise.all([runOfflineCheck(), runOfflineCheck()]);
    expect(a + b).toBe(1);
    expect(await runOfflineCheck()).toBe(0);
    await drive(IMEI_A, 43.8, -79.8, 0, null); // back online → re-arms
    await getDb().update(schema.gpsDevices).set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(schema.gpsDevices.id, devA));
    expect(await runOfflineCheck()).toBe(1);
    const off = (await events(orgA)).filter((e) => e.type === "device_offline");
    expect(off.map((e) => e.deviceId)).toEqual([devA, devA]);
  });
});

describe("alerts API", () => {
  it("lists newest first with unacknowledged count; acknowledgement is org-scoped", async () => {
    const res = await alertsGET(req("GET", "/api/alerts?limit=5", "viewer"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(5);
    expect(body.events[0].id).toBeGreaterThan(body.events[1].id);
    expect(body.events[0]).toHaveProperty("vehicleName");
    const total = body.unacknowledged as number;
    expect((await ackPOST(req("POST", "/api/alerts/acknowledge", "viewer", { all: true }))).status).toBe(403);
    // bob acknowledging org A's ids touches nothing
    const ids = body.events.map((e: { id: number }) => e.id);
    expect(await (await ackPOST(req("POST", "/api/alerts/acknowledge", "bob", { ids }))).json()).toEqual({ acknowledged: 0 });
    expect(await (await ackPOST(req("POST", "/api/alerts/acknowledge", "dispatch", { ids: [ids[0]] }))).json()).toEqual({ acknowledged: 1 });
    const after = await (await alertsGET(req("GET", "/api/alerts?unacknowledged=1", "admin"))).json();
    expect(after.unacknowledged).toBe(total - 1);
    expect(await (await ackPOST(req("POST", "/api/alerts/acknowledge", "admin", { all: true }))).json()).toEqual({ acknowledged: total - 1 });
  });

  it("deleting a geofence removes its rules but keeps event history", async () => {
    const before = (await events(orgA)).length;
    expect((await geofenceDELETE(req("DELETE", `/api/geofences/${depotId}`, "admin"), { params: Promise.resolve({ id: depotId }) })).status).toBe(204);
    const rules = await getDb().select().from(schema.alertRules).where(eq(schema.alertRules.geofenceId, depotId));
    expect(rules).toHaveLength(0);
    expect((await events(orgA)).length).toBe(before);
  });
});
