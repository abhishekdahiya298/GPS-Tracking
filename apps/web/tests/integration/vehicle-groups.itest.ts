import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as activityGET } from "@/app/api/reports/activity/route";
import { GET as groupsGET, POST as groupsPOST } from "@/app/api/vehicle-groups/route";
import { DELETE as groupDELETE, PATCH as groupPATCH } from "@/app/api/vehicle-groups/[id]/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;
let a1: string, a2: string, a3: string, b1: string, orgA: string;
const IMEI = ["864361078566115", "350000000000088", "350000000000096"];

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.7.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown, origin = BASE) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const list = async (who: string) => ((await (await groupsGET(req("GET", "/api/vehicle-groups", who))).json()) as { groups: { id: string; name: string; vehicleIds: string[] }[] }).groups;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a, b] = await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]).returning();
  orgA = a!.id;
  const va = await db.insert(schema.vehicles).values([{ organizationId: a!.id, name: "East 1" }, { organizationId: a!.id, name: "East 2" }, { organizationId: a!.id, name: "West 1" }]).returning();
  [a1, a2, a3] = va.map((v) => v.id) as [string, string, string];
  b1 = (await db.insert(schema.vehicles).values({ organizationId: b!.id, name: "B truck" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: a!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  // East 1 and West 1 have trackers that drove on Sep 24.
  for (const [i, vehicleId] of [[0, a1], [1, a3]] as const) {
    const d = (await db.insert(schema.gpsDevices).values({ organizationId: a!.id, providerId: pa.id, externalDeviceId: IMEI[i]!, imei: IMEI[i]! }).returning())[0]!;
    await db.insert(schema.deviceAssignments).values({ organizationId: a!.id, deviceId: d.id, vehicleId });
    for (let m = 0; m <= 10; m++)
      await ingestPosition({ externalDeviceId: IMEI[i]!, imei: IMEI[i]!, latitude: 43.6 + m * 0.009, longitude: -79.7 - i, speedKph: m === 10 ? 0 : 60, headingDeg: 0, altitudeM: 0, recordedAt: new Date(Date.parse("2026-09-24T12:00:00Z") + m * 60_000), valid: true, ignition: true, motion: true });
  }
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "VIEWER") => createUserWithMembership({ email, name: email, password: PASSWORD, organizationSlug: slug, role });
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("admin@b.test", "org-b", "ORG_ADMIN");
  for (const [k, e] of [["fleet", "fleet@a.test"], ["viewer", "viewer@a.test"], ["bob", "admin@b.test"]] as const) cookies[k] = await signIn(e);
});
afterAll(async () => {
  await closeDb();
});

describe("vehicle groups", () => {
  let east: string;

  it("fleet managers create groups; viewers can read but not change; cross-origin writes are refused", async () => {
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "viewer", { name: "East" }))).status).toBe(403);
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "East" }, "https://evil.example"))).status).toBe(403);
    const res = await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "  East  ", vehicleIds: [a1, a2] }));
    expect(res.status).toBe(201);
    east = (await res.json()).group.id;
    expect(await list("viewer")).toEqual([{ id: east, name: "East", vehicleIds: expect.arrayContaining([a1, a2]) }]);
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "vehicle_group.created"));
    expect(audit).toMatchObject({ organizationId: orgA, targetId: east, metadata: { name: "East", vehicles: 2 } });
  });

  it("names are unique per organization (case-insensitive); validation", async () => {
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "east" }))).status).toBe(409);
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "   " }))).status).toBe(400);
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "x".repeat(61) }))).status).toBe(400);
    // another organization may use the same name
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "bob", { name: "East", vehicleIds: [b1] }))).status).toBe(201);
  });

  it("tenant isolation: no foreign vehicles in a group, no access to foreign groups", async () => {
    expect((await groupsPOST(req("POST", "/api/vehicle-groups", "fleet", { name: "Mixed", vehicleIds: [a1, b1] }))).status).toBe(400);
    expect((await groupPATCH(req("PATCH", `/api/vehicle-groups/${east}`, "fleet", { vehicleIds: [b1] }), params(east))).status).toBe(400);
    expect((await groupPATCH(req("PATCH", `/api/vehicle-groups/${east}`, "bob", { name: "Hacked" }), params(east))).status).toBe(404);
    expect((await groupDELETE(req("DELETE", `/api/vehicle-groups/${east}`, "bob"), params(east))).status).toBe(404);
    expect((await list("bob")).map((g) => g.name)).toEqual(["East"]);
    expect((await list("bob"))[0]!.vehicleIds).toEqual([b1]);
    expect((await list("fleet"))[0]!.vehicleIds.sort()).toEqual([a1, a2].sort()); // unchanged
    expect((await groupPATCH(req("PATCH", "/api/vehicle-groups/not-a-uuid", "fleet", { name: "x" }), params("not-a-uuid"))).status).toBe(404);
  });

  it("rename and replace members", async () => {
    expect((await groupPATCH(req("PATCH", `/api/vehicle-groups/${east}`, "viewer", { name: "No" }), params(east))).status).toBe(403);
    expect((await groupPATCH(req("PATCH", `/api/vehicle-groups/${east}`, "fleet", { name: "Eastern", vehicleIds: [a1] }), params(east))).status).toBe(200);
    expect(await list("fleet")).toEqual([{ id: east, name: "Eastern", vehicleIds: [a1] }]);
    expect((await groupPATCH(req("PATCH", `/api/vehicle-groups/${east}`, "fleet", {}), params(east))).status).toBe(400);
  });

  it("the vehicle list filters by group and shows group names", async () => {
    const page = async (qs: string, who = "fleet") => (await (await vehiclesGET(req("GET", `/api/vehicles?${qs}`, who))).json()) as { total: number; items: { name: string; groups: string[] }[] };
    const all = await page("page=1");
    expect(all.total).toBe(3);
    expect(all.items.find((v) => v.name === "East 1")!.groups).toEqual(["Eastern"]);
    expect(all.items.find((v) => v.name === "West 1")!.groups).toEqual([]);
    const inGroup = await page(`page=1&group=${east}`);
    expect(inGroup.items.map((v) => v.name)).toEqual(["East 1"]);
    // Org B asking for Org A's group id gets nothing from either organization.
    expect((await page(`page=1&group=${east}`, "bob")).total).toBe(0);
  });

  it("reports can be limited to a group; a foreign group is a 404", async () => {
    const run = (qs: Record<string, string>, who = "fleet") =>
      activityGET(new Request(`${BASE}/api/reports/activity?${new URLSearchParams({ type: "mileage", from: "2026-09-24T04:00:00Z", to: "2026-09-25T04:00:00Z", ...qs })}`, { headers: { cookie: cookies[who]! } }));
    const all = await (await run({})).json();
    expect(all.byVehicle.map((v: { vehicle: string }) => v.vehicle).sort()).toEqual(["East 1", "West 1"]);
    const grouped = await (await run({ groupId: east })).json();
    expect(grouped.byVehicle.map((v: { vehicle: string }) => v.vehicle)).toEqual(["East 1"]);
    expect(grouped.vehicles).toBe(1);
    expect((await run({ groupId: east }, "bob")).status).toBe(404);
    expect((await run({ groupId: "nope" })).status).toBe(400);
  });

  it("deleting a group keeps the vehicles; deleting a vehicle leaves the group", async () => {
    expect((await groupDELETE(req("DELETE", `/api/vehicle-groups/${east}`, "viewer"), params(east))).status).toBe(403);
    expect((await groupDELETE(req("DELETE", `/api/vehicle-groups/${east}`, "fleet"), params(east))).status).toBe(200);
    expect(await list("fleet")).toEqual([]);
    expect(await getDb().select().from(schema.vehicles).where(eq(schema.vehicles.organizationId, orgA))).toHaveLength(3);
    expect(await getDb().select().from(schema.vehicleGroupMembers).where(eq(schema.vehicleGroupMembers.organizationId, orgA))).toHaveLength(0);
    expect((await groupDELETE(req("DELETE", `/api/vehicle-groups/${east}`, "fleet"), params(east))).status).toBe(404);
  });
});
