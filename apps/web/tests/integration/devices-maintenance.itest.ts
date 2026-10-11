import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { ingestPosition } from "@/lib/ingest";
import { listCurrentLocations } from "@/lib/locations";
import { kmDriven, runMaintenanceCheck } from "@/lib/maintenance";
import { PATCH as devicePATCH } from "@/app/api/devices/[id]/route";
import { GET as devicesGET } from "@/app/api/devices/route";
import { DELETE as itemDELETE, PATCH as itemPATCH } from "@/app/api/maintenance/[id]/route";
import { POST as servicePOST } from "@/app/api/maintenance/[id]/service/route";
import { GET as maintGET, POST as maintPOST } from "@/app/api/maintenance/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let orgA = "", devA = "", devB = "", vehA = "", vehB = "";
const outbox: EmailMessage[] = [];
let ipN = 1;
const now = Date.now();

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${100 + ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, who: string, body?: unknown) =>
  new Request(`${BASE}/api/x`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pos = (t: number, lat: number, speed: number, ignition: boolean, imei = IMEI) =>
  ingestPosition({ externalDeviceId: imei, imei, latitude: lat, longitude: -79.7, speedKph: speed, headingDeg: 0, altitudeM: 0, recordedAt: new Date(t), valid: true, ignition, motion: speed > 0 });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  orgA = (await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning())[0]!.id;
  const orgB = (await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb.id, externalDeviceId: "350000000000088", imei: "350000000000088", model: "FMB920" }).returning())[0]!.id;
  vehA = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Truck 7" }).returning())[0]!.id;
  vehB = (await db.insert(schema.vehicles).values({ organizationId: orgB, name: "B van" }).returning())[0]!.id;
  await db.insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: devA, vehicleId: vehA });
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "VIEWER") => createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role });
  await mk("admin@a.test", "org-a", "ORG_ADMIN");
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("bob@b.test", "org-b", "ORG_ADMIN");
  for (const k of ["admin", "fleet", "viewer", "bob"]) {
    const email = `${k}@${k === "bob" ? "b" : "a"}.test`;
    cookies[k] = await signIn(email);
    ids[k] = (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0]!.id;
  }
  setEmailTransportForTests(async (m) => {
    outbox.push(m);
  });
});
beforeEach(() => {
  outbox.length = 0;
});
afterAll(async () => {
  setEmailTransportForTests(null);
  await closeDb();
});

describe("device management", () => {
  it("only Org Admins can rename or deactivate", async () => {
    expect((await devicePATCH(req("PATCH", "fleet", { name: "x" }), p(devA))).status).toBe(403);
    expect((await devicePATCH(req("PATCH", "viewer", { active: false }), p(devA))).status).toBe(403);
    expect((await devicePATCH(req("PATCH", "bob", { name: "mine now" }), p(devA))).status).toBe(404);
    expect((await devicePATCH(req("PATCH", "admin", { name: "Truck 7 tracker" }), p(devA))).status).toBe(200);
    expect((await devicePATCH(req("PATCH", "admin", {}), p(devA))).status).toBe(400);
  });

  it("IMEI last 4 is shown to Org Admins only; full IMEI never", async () => {
    const admin = await (await devicesGET(req("GET", "admin"))).json();
    expect(admin.devices[0]).toMatchObject({ name: "Truck 7 tracker", imeiLast4: "6115" });
    const fleet = await (await devicesGET(req("GET", "fleet"))).json();
    expect(fleet.devices[0].imeiLast4).toBeUndefined();
    expect(JSON.stringify(admin)).not.toContain(IMEI);
  });

  it("a deactivated device stores nothing and leaves the live map; reactivation resumes", async () => {
    expect((await devicePATCH(req("PATCH", "admin", { active: false }), p(devA))).status).toBe(200);
    expect(await pos(now - 3 * 3600_000, 43.5, 20, true)).toMatchObject({ status: "device_inactive" });
    expect(await getDb().select().from(schema.locationHistory)).toHaveLength(0);
    expect(await listCurrentLocations(orgA, new Date(), 600)).toHaveLength(0);
    expect((await devicePATCH(req("PATCH", "admin", { active: true }), p(devA))).status).toBe(200);
    expect(await pos(now - 3 * 3600_000, 43.5, 20, true)).toMatchObject({ status: "stored" });
    expect(await listCurrentLocations(orgA, new Date(), 600)).toHaveLength(1);
    const actions = (await getDb().select({ a: schema.auditLogs.action }).from(schema.auditLogs)).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["device.renamed", "device.deactivated", "device.reactivated"]));
  });

  it("retired devices can't be reactivated by the customer", async () => {
    await getDb().update(schema.gpsDevices).set({ status: "retired" }).where(eq(schema.gpsDevices.id, devB));
    expect((await devicePATCH(req("PATCH", "bob", { active: true }), p(devB))).status).toBe(409);
  });
});

describe("maintenance", () => {
  const t0 = now - 2 * 3600_000;
  let kmItem = "", dayItem = "", okItem = "";

  beforeAll(async () => {
    await getDb().delete(schema.locationHistory);
    await getDb().delete(schema.currentLocations);
    // 10-minute drive, 0.0045° lat per minute ≈ 0.5 km/min → ≈ 5.0 km
    for (let i = 0; i <= 10; i++) await pos(t0 + i * 60_000, 43.6 + i * 0.0045, i === 10 ? 0 : 30, i < 10);
    // parked GPS drift (ignition off, speed 0) must not count
    for (let i = 1; i <= 10; i++) await pos(t0 + (10 + i) * 60_000, 43.645 + (i % 2) * 0.0004, 0, false);
    // a teleport glitch (100 km in one minute) must not count
    await pos(t0 + 25 * 60_000, 44.6, 40, true);
  });

  it("measures km driven from history, ignoring drift and jumps", async () => {
    const km = await kmDriven(orgA, vehA, new Date(t0 - 1000), new Date());
    expect(km).toBeGreaterThan(4.95);
    expect(km).toBeLessThan(5.1);
  });

  it("VIEWER can read but not write; foreign vehicles and recipients are rejected", async () => {
    expect((await maintGET(req("GET", "viewer"))).status).toBe(200);
    const body = { vehicleId: vehA, name: "Oil", intervalKm: 1000, lastServiceAt: new Date(now - 86400_000).toISOString() };
    expect((await maintPOST(req("POST", "viewer", body))).status).toBe(403);
    expect((await maintPOST(req("POST", "admin", { ...body, vehicleId: vehB }))).status).toBe(400);
    expect((await maintPOST(req("POST", "admin", { ...body, notifyUserIds: [ids.bob] }))).status).toBe(400);
    expect((await maintPOST(req("POST", "admin", { ...body, intervalKm: null }))).status).toBe(400);
    expect((await maintPOST(req("POST", "admin", { ...body, lastServiceAt: new Date(now + 5 * 86400_000).toISOString() }))).status).toBe(400);
  });

  it("computes ok / due soon / overdue", async () => {
    const since = new Date(t0 - 60_000).toISOString();
    const mk = async (b: object) => (await (await maintPOST(req("POST", "fleet", { vehicleId: vehA, lastServiceAt: since, notifyUserIds: [ids.admin, ids.fleet], ...b }))).json()).id as string;
    okItem = await mk({ name: "Tyres", intervalKm: 20000 });
    kmItem = await mk({ name: "Oil change", intervalKm: 4 });
    dayItem = await mk({ name: "Inspection", intervalDays: 30, lastServiceAt: new Date(now - 25 * 86400_000).toISOString() });
    const { items } = await (await maintGET(req("GET", "viewer"))).json();
    const by = (id: string) => items.find((i: { id: string }) => i.id === id);
    expect(by(okItem).status).toMatchObject({ state: "ok" });
    expect(by(okItem).status.kmSinceService).toBeGreaterThan(4.9);
    expect(by(kmItem).status.state).toBe("overdue");
    expect(by(dayItem).status).toMatchObject({ state: "due_soon", daysRemaining: 5 });
    expect(items.every((i: { vehicleName: string }) => i.vehicleName === "Truck 7")).toBe(true);
  });

  it("emails once per state change, concurrently safe", async () => {
    const [a, b] = await Promise.all([runMaintenanceCheck(), runMaintenanceCheck()]);
    expect(a + b).toBe(2);
    expect(outbox).toHaveLength(4); // 2 items × 2 recipients
    expect(outbox.map((m) => m.subject).sort()).toEqual([
      "RIO GPS maintenance: Truck 7: Inspection is due soon",
      "RIO GPS maintenance: Truck 7: Inspection is due soon",
      "RIO GPS maintenance: Truck 7: Oil change is overdue",
      "RIO GPS maintenance: Truck 7: Oil change is overdue"
    ]);
    outbox.length = 0;
    expect(await runMaintenanceCheck()).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("mark serviced records history and restarts the interval", async () => {
    expect((await servicePOST(req("POST", "viewer", {}), p(dayItem))).status).toBe(403);
    expect((await servicePOST(req("POST", "fleet", { odometerKm: 123456, note: "Passed" }), p(dayItem))).status).toBe(201);
    expect((await servicePOST(req("POST", "fleet", { odometerKm: 123460 }), p(kmItem))).status).toBe(201);
    const { items } = await (await maintGET(req("GET", "admin"))).json();
    const day = items.find((i: { id: string }) => i.id === dayItem);
    expect(day.status).toMatchObject({ state: "ok", daysRemaining: 30 });
    expect(day.history[0]).toMatchObject({ odometerKm: 123456, note: "Passed" });
    const km = items.find((i: { id: string }) => i.id === kmItem);
    expect(km.history[0].kmSincePrevious).toBe(5);
    expect(km.status.kmSinceService).toBe(0);
  });

  it("other organizations can't read, change, service or delete items", async () => {
    const bobList = await (await maintGET(req("GET", "bob"))).json();
    expect(bobList.items).toHaveLength(0);
    expect((await itemPATCH(req("PATCH", "bob", { name: "x" }), p(okItem))).status).toBe(404);
    expect((await servicePOST(req("POST", "bob", {}), p(okItem))).status).toBe(404);
    expect((await itemDELETE(req("DELETE", "bob"), p(okItem))).status).toBe(404);
    expect((await itemDELETE(req("DELETE", "admin"), p(okItem))).status).toBe(204);
  });
});
