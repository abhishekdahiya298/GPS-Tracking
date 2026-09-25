import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as vehicleGET } from "@/app/api/vehicles/[id]/route";
import { GET as devicesGET } from "@/app/api/devices/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
const vid: Record<string, string> = {};
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.19.0.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = (fn: (r: Request) => Promise<Response>, path: string, who: string) => fn(new Request(`${BASE}${path}`, { headers: { cookie: cookies[who]! } }));
const json = async (res: Response) => {
  expect(res.status).toBe(200);
  return res.json();
};

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: a!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: b!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  // Org A: 30 vehicles ("Truck 01".."Truck 30"), plus "100% Diesel" and "Van_X" for escaping tests.
  const names = [...Array.from({ length: 30 }, (_, i) => `Truck ${String(i + 1).padStart(2, "0")}`), "100% Diesel", "Van_X"];
  for (const n of names) vid[n] = (await db.insert(schema.vehicles).values({ organizationId: a!.id, name: n, licensePlate: n === "Van_X" ? "CA-777" : null }).returning())[0]!.id;
  vid.secret = (await db.insert(schema.vehicles).values({ organizationId: b!.id, name: "Truck B secret" }).returning())[0]!.id;
  // Devices: Truck 01 moving, Truck 02 idle, Truck 03 never seen; one unassigned device.
  const mkDev = async (org: string, prov: string, imei: string, name: string | null) =>
    (await db.insert(schema.gpsDevices).values({ organizationId: org, providerId: prov, externalDeviceId: imei, imei, model: "FTM880", name }).returning())[0]!.id;
  const d1 = await mkDev(a!.id, pa.id, "860000000000011", "Tracker one");
  const d2 = await mkDev(a!.id, pa.id, "860000000000022", null);
  const d3 = await mkDev(a!.id, pa.id, "860000000000033", null);
  await mkDev(a!.id, pa.id, "860000000000044", "Spare");
  await mkDev(b!.id, pb.id, "860000000000099", "B tracker");
  await db.insert(schema.deviceAssignments).values([
    { organizationId: a!.id, deviceId: d1, vehicleId: vid["Truck 01"]! },
    { organizationId: a!.id, deviceId: d2, vehicleId: vid["Truck 02"]! },
    { organizationId: a!.id, deviceId: d3, vehicleId: vid["Truck 03"]! }
  ]);
  const now = Date.now();
  const fix = (imei: string, speed: number) =>
    ingestPosition({ externalDeviceId: imei, imei, latitude: 34, longitude: -118, speedKph: speed, headingDeg: 90, altitudeM: 0, recordedAt: new Date(now - 30_000), valid: true, ignition: speed > 0, motion: speed > 0 });
  await fix("860000000000011", 60);
  await fix("860000000000022", 0);
  await createUserWithMembership({ email: "admin@a.test", name: "A", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "viewer@a.test", name: "V", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "bob@b.test", name: "B", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookies.admin = await signIn("admin@a.test");
  cookies.viewer = await signIn("viewer@a.test");
  cookies.bob = await signIn("bob@b.test");
});
afterAll(async () => {
  await closeDb();
});

describe("vehicles list (server-side)", () => {
  it("paginates with totals and never leaks another organization", async () => {
    const p1 = await json(await get(vehiclesGET, "/api/vehicles?page=1&pageSize=10&sort=name", "viewer"));
    expect(p1.items).toHaveLength(10);
    expect(p1.total).toBe(32);
    expect(p1.counts).toMatchObject({ all: 32, moving: 1, idle: 1, never_seen: 1, no_device: 29 });
    const p4 = await json(await get(vehiclesGET, "/api/vehicles?page=4&pageSize=10&sort=name", "viewer"));
    expect(p4.items).toHaveLength(2);
    const bob = await json(await get(vehiclesGET, "/api/vehicles?page=1&search=Truck", "bob"));
    expect(bob.items.map((v: { name: string }) => v.name)).toEqual(["Truck B secret"]);
  });

  it("default sort puts moving then idle vehicles first, with live status", async () => {
    const r = await json(await get(vehiclesGET, "/api/vehicles?page=1&pageSize=10", "viewer"));
    expect(r.items[0]).toMatchObject({ name: "Truck 01", state: "moving", device: { name: "Tracker one" } });
    expect(r.items[0].location.speedKph).toBe(60);
    expect(r.items[1]).toMatchObject({ name: "Truck 02", state: "idle" });
  });

  it("search treats % and _ literally and matches plates", async () => {
    const pct = await json(await get(vehiclesGET, `/api/vehicles?search=${encodeURIComponent("100%")}`, "viewer"));
    expect(pct.items.map((v: { name: string }) => v.name)).toEqual(["100% Diesel"]);
    const us = await json(await get(vehiclesGET, `/api/vehicles?search=${encodeURIComponent("n_")}`, "viewer"));
    expect(us.items.map((v: { name: string }) => v.name)).toEqual(["Van_X"]);
    const plate = await json(await get(vehiclesGET, "/api/vehicles?search=ca-777", "viewer"));
    expect(plate.total).toBe(1);
  });

  it("state filter and descending sort", async () => {
    const moving = await json(await get(vehiclesGET, "/api/vehicles?state=moving", "viewer"));
    expect(moving.items.map((v: { name: string }) => v.name)).toEqual(["Truck 01"]);
    const desc = await json(await get(vehiclesGET, "/api/vehicles?sort=name&direction=desc&pageSize=10", "viewer"));
    expect(desc.items[0].name).toBe("Van_X");
  });

  it("invalid parameters fall back to safe defaults instead of erroring", async () => {
    const r = await json(await get(vehiclesGET, "/api/vehicles?page=-5&pageSize=100000&sort=password&direction=sideways&state=x", "viewer"));
    expect(r).toMatchObject({ page: 1, pageSize: 25 });
    expect(r.items).toHaveLength(25);
  });

  it("the legacy (unpaged) shape still works", async () => {
    const r = await json(await get(vehiclesGET, "/api/vehicles", "viewer"));
    expect(r.vehicles).toHaveLength(32);
  });
});

describe("vehicle detail", () => {
  it("returns device + position; IMEI last 4 only for Org Admins", async () => {
    const admin = await json(await get((r) => vehicleGET(r, { params: Promise.resolve({ id: vid["Truck 01"]! }) }), "/", "admin"));
    expect(admin).toMatchObject({ vehicle: { name: "Truck 01" }, state: "moving", device: { name: "Tracker one", imeiLast4: "0011" } });
    expect(admin.location.headingDeg).toBe(90);
    const viewer = await json(await get((r) => vehicleGET(r, { params: Promise.resolve({ id: vid["Truck 01"]! }) }), "/", "viewer"));
    expect(viewer.device.imeiLast4).toBeUndefined();
    expect(JSON.stringify(viewer)).not.toContain("860000000000011");
  });
  it("another organization's vehicle is a 404", async () => {
    const res = await get((r) => vehicleGET(r, { params: Promise.resolve({ id: vid.secret! }) }), "/", "admin");
    expect(res.status).toBe(404);
  });
});

describe("devices list (server-side)", () => {
  it("filters unassigned and counts states", async () => {
    const r = await json(await get(devicesGET, "/api/devices?page=1", "admin"));
    expect(r.total).toBe(4);
    expect(r.counts).toMatchObject({ all: 4, online: 2, never_seen: 2, unassigned: 1 });
    const un = await json(await get(devicesGET, "/api/devices?state=unassigned", "admin"));
    expect(un.items.map((d: { name: string }) => d.name)).toEqual(["Spare"]);
  });
  it("IMEI suffix search only for Org Admins", async () => {
    const admin = await json(await get(devicesGET, "/api/devices?search=0044", "admin"));
    expect(admin.items.map((d: { name: string }) => d.name)).toEqual(["Spare"]);
    const viewer = await json(await get(devicesGET, "/api/devices?search=0044", "viewer"));
    expect(viewer.total).toBe(0);
  });
  it("deactivated devices show as inactive", async () => {
    await getDb().update(schema.gpsDevices).set({ status: "inactive" }).where(eq(schema.gpsDevices.name, "Spare"));
    const r = await json(await get(devicesGET, "/api/devices?state=inactive", "admin"));
    expect(r.items.map((d: { name: string; state: string }) => [d.name, d.state])).toEqual([["Spare", "inactive"]]);
  });
});
