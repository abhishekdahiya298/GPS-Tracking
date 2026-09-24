import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as opsGET } from "@/app/api/admin/ops/route";
import { GET as devicesGET } from "@/app/api/devices/route";
import { DELETE as unassignDELETE, PUT as assignPUT } from "@/app/api/devices/[id]/assignment/route";
import { DELETE as vehicleDELETE, PATCH as vehiclePATCH } from "@/app/api/vehicles/[id]/route";
import { GET as vehiclesGET, POST as vehiclesPOST } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI_A = "864361078566115";
let orgA: string, orgB: string, devA: string, devB: string, vehB: string;
const cookies: Record<string, string> = {};

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function req(method: string, path: string, who: string, body?: unknown, origin: string | null = BASE) {
  const headers: Record<string, string> = { cookie: cookies[who]!, "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  orgA = (await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning())[0]!.id;
  orgB = (await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI_A, imei: IMEI_A, model: "FTM880" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb.id, externalDeviceId: "350000000000009", imei: "350000000000009", model: "FMM230" }).returning())[0]!.id;
  vehB = (await db.insert(schema.vehicles).values({ organizationId: orgB, name: "B Truck" }).returning())[0]!.id;
  const users: [string, string, "ORG_ADMIN" | "FLEET_MANAGER" | "DISPATCHER" | "VIEWER"][] = [
    ["admin", "org-a", "ORG_ADMIN"],
    ["fleet", "org-a", "FLEET_MANAGER"],
    ["dispatch", "org-a", "DISPATCHER"],
    ["viewer", "org-a", "VIEWER"]
  ];
  let i = 0;
  for (const [who, slug, role] of users) {
    await createUserWithMembership({ email: `${who}@a.test`, name: who, password: PASSWORD, organizationSlug: slug, role });
    cookies[who] = await signIn(`${who}@a.test`, `192.0.2.${150 + i++}`);
  }
  await createUserWithMembership({ email: "root@a.test", name: "root", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER", superAdmin: true });
  cookies.root = await signIn("root@a.test", "192.0.2.170");
});

afterAll(async () => {
  await closeDb();
});

describe("vehicles", () => {
  let rr: string;

  it("FLEET_MANAGER creates a vehicle (audited)", async () => {
    const res = await vehiclesPOST(req("POST", "/api/vehicles", "fleet", { name: "  Range Rover ", licensePlate: "RIO-1" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    rr = body.vehicle.id;
    expect(body.vehicle).toMatchObject({ name: "Range Rover", licensePlate: "RIO-1", status: "active" });
    const [row] = await getDb().select().from(schema.vehicles).where(eq(schema.vehicles.id, rr));
    expect(row!.organizationId).toBe(orgA);
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "vehicle.created"));
    expect(audit[0]).toMatchObject({ organizationId: orgA, targetId: rr });
  });

  it("ignores a client-supplied organizationId", async () => {
    const res = await vehiclesPOST(req("POST", "/api/vehicles", "fleet", { name: "Sneaky", organizationId: orgB }));
    expect(res.status).toBe(201);
    const id = (await res.json()).vehicle.id;
    const [row] = await getDb().select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
    expect(row!.organizationId).toBe(orgA);
    expect((await vehicleDELETE(req("DELETE", `/api/vehicles/${id}`, "admin"), p(id))).status).toBe(204);
  });

  it("RBAC: VIEWER and DISPATCHER cannot create, update or delete", async () => {
    for (const who of ["viewer", "dispatch"]) {
      expect((await vehiclesPOST(req("POST", "/api/vehicles", who, { name: "X" }))).status).toBe(403);
      expect((await vehiclePATCH(req("PATCH", `/api/vehicles/${rr}`, who, { name: "X" }), p(rr))).status).toBe(403);
      expect((await vehicleDELETE(req("DELETE", `/api/vehicles/${rr}`, who), p(rr))).status).toBe(403);
    }
    expect((await vehiclesGET(req("GET", "/api/vehicles", "viewer"))).status).toBe(200);
  });

  it("CSRF: mutating requests without a same-site Origin are rejected", async () => {
    expect((await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "X" }, null))).status).toBe(403);
    expect((await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "X" }, "https://evil.test"))).status).toBe(403);
  });

  it("validates input", async () => {
    expect((await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "" }))).status).toBe(400);
    expect((await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "x".repeat(121) }))).status).toBe(400);
    expect((await vehiclePATCH(req("PATCH", `/api/vehicles/${rr}`, "admin", {}), p(rr))).status).toBe(400);
    expect((await vehiclePATCH(req("PATCH", `/api/vehicles/${rr}`, "admin", { status: "stolen" }), p(rr))).status).toBe(400);
    expect((await vehiclePATCH(req("PATCH", "/api/vehicles/not-a-uuid", "admin", { name: "x" }), p("not-a-uuid"))).status).toBe(404);
  });

  it("another org's vehicle is a 404 for read-modify operations", async () => {
    expect((await vehiclePATCH(req("PATCH", `/api/vehicles/${vehB}`, "admin", { name: "pwned" }), p(vehB))).status).toBe(404);
    expect((await vehicleDELETE(req("DELETE", `/api/vehicles/${vehB}`, "admin"), p(vehB))).status).toBe(404);
    const [b] = await getDb().select().from(schema.vehicles).where(eq(schema.vehicles.id, vehB));
    expect(b!.name).toBe("B Truck");
    const list = await (await vehiclesGET(req("GET", "/api/vehicles", "admin"))).json();
    expect(JSON.stringify(list)).not.toContain(vehB);
  });

  it("assigns a device, attributes new history to the vehicle, and moves it atomically", async () => {
    expect((await assignPUT(req("PUT", `/api/devices/${devA}/assignment`, "dispatch", { vehicleId: rr }), p(devA))).status).toBe(403);
    expect((await assignPUT(req("PUT", `/api/devices/${devA}/assignment`, "fleet", { vehicleId: rr }), p(devA))).status).toBe(200);
    expect((await assignPUT(req("PUT", `/api/devices/${devA}/assignment`, "fleet", { vehicleId: rr }), p(devA))).status).toBe(409);

    const out = await ingestPosition({
      externalDeviceId: IMEI_A, imei: IMEI_A, latitude: 43.7, longitude: -79.7, speedKph: 30, headingDeg: 0, altitudeM: 200,
      recordedAt: new Date("2026-09-25T01:00:00Z"), valid: true, ignition: true, motion: true
    });
    expect(out.status).toBe("stored");
    const [h] = await getDb().select().from(schema.locationHistory).where(eq(schema.locationHistory.deviceId, devA));
    expect(h!.vehicleId).toBe(rr);

    const second = (await (await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "Spare" }))).json()).vehicle.id;
    expect((await assignPUT(req("PUT", `/api/devices/${devA}/assignment`, "admin", { vehicleId: second }), p(devA))).status).toBe(200);
    const active = await getDb()
      .select()
      .from(schema.deviceAssignments)
      .where(and(eq(schema.deviceAssignments.deviceId, devA), isNull(schema.deviceAssignments.unassignedAt)));
    expect(active).toHaveLength(1);
    expect(active[0]!.vehicleId).toBe(second);
    const all = await getDb().select().from(schema.deviceAssignments).where(eq(schema.deviceAssignments.deviceId, devA));
    expect(all).toHaveLength(2);

    const devs = await (await devicesGET(req("GET", "/api/devices", "viewer"))).json();
    expect(devs.devices).toHaveLength(1);
    expect(devs.devices[0]).toMatchObject({ id: devA, vehicle: { id: second, name: "Spare" } });
    expect(JSON.stringify(devs)).not.toContain(IMEI_A);
  });

  it("cross-org assignment is impossible in both directions", async () => {
    expect((await assignPUT(req("PUT", `/api/devices/${devA}/assignment`, "admin", { vehicleId: vehB }), p(devA))).status).toBe(404);
    expect((await assignPUT(req("PUT", `/api/devices/${devB}/assignment`, "admin", { vehicleId: rr }), p(devB))).status).toBe(404);
    expect((await unassignDELETE(req("DELETE", `/api/devices/${devB}/assignment`, "admin"), p(devB))).status).toBe(404);
    const bAssign = await getDb().select().from(schema.deviceAssignments).where(eq(schema.deviceAssignments.deviceId, devB));
    expect(bAssign).toHaveLength(0);
  });

  it("unassign closes the active assignment; a second unassign is 409", async () => {
    expect((await unassignDELETE(req("DELETE", `/api/devices/${devA}/assignment`, "viewer"), p(devA))).status).toBe(403);
    expect((await unassignDELETE(req("DELETE", `/api/devices/${devA}/assignment`, "fleet"), p(devA))).status).toBe(204);
    expect((await unassignDELETE(req("DELETE", `/api/devices/${devA}/assignment`, "fleet"), p(devA))).status).toBe(409);
  });

  it("refuses to delete a vehicle with history/assignments (409); an unused one deletes (204)", async () => {
    expect((await vehicleDELETE(req("DELETE", `/api/vehicles/${rr}`, "admin"), p(rr))).status).toBe(409);
    const tmp = (await (await vehiclesPOST(req("POST", "/api/vehicles", "admin", { name: "Temp" }))).json()).vehicle.id;
    expect((await vehicleDELETE(req("DELETE", `/api/vehicles/${tmp}`, "admin"), p(tmp))).status).toBe(204);
    const actions = (await getDb().select({ a: schema.auditLogs.action }).from(schema.auditLogs)).map((r) => r.a);
    for (const a of ["vehicle.created", "vehicle.deleted", "device.assigned", "device.unassigned"]) expect(actions).toContain(a);
  });

  it("PATCH updates fields (audited)", async () => {
    const res = await vehiclePATCH(req("PATCH", `/api/vehicles/${rr}`, "fleet", { status: "maintenance", licensePlate: "" }), p(rr));
    expect(res.status).toBe(200);
    expect((await res.json()).vehicle).toMatchObject({ status: "maintenance", licensePlate: null });
  });
});

describe("admin ops", () => {
  it("is super-admin only and returns aggregates", async () => {
    expect((await opsGET(new Request(`${BASE}/api/admin/ops`))).status).toBe(401);
    expect((await opsGET(req("GET", "/api/admin/ops", "admin"))).status).toBe(403);
    const res = await opsGET(req("GET", "/api/admin/ops", "root"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.database.ok).toBe(true);
    expect(body.redis.ok).toBe(true);
    expect(body.database.devices.total).toBe(2);
    expect(body.database.organizations).toBe(2);
    expect(JSON.stringify(body)).not.toMatch(/latitude|longitude|864361078566115/);
  });
});
