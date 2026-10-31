import "./setup-env";
import type { NormalizedPosition } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { clearOrganizationStatusCache } from "@/lib/organization-status";
import { getPlatformOverview, listPlatformTrackers, PlatformTrackerQuery } from "@/lib/platform";
import { listSims, SimListQuery } from "@/lib/sims";
import { setTraccarAdminForTests } from "@/lib/traccar";
import { PATCH as customerPATCH } from "@/app/api/admin/customers/[id]/route";
import { POST as memberAddPOST } from "@/app/api/admin/customers/[id]/members/route";
import { DELETE as memberDELETE, PATCH as memberPATCH } from "@/app/api/admin/customers/[id]/members/[userId]/route";
import { POST as memberResetPOST } from "@/app/api/admin/customers/[id]/members/[userId]/reset-password/route";
import { POST as devicesPOST } from "@/app/api/admin/customers/[id]/devices/route";
import { POST as stockPOST } from "@/app/api/admin/trackers/route";
import { POST as stockBulkPOST } from "@/app/api/admin/trackers/bulk/route";
import { POST as assignPOST } from "@/app/api/admin/trackers/[id]/assign/route";
import { POST as movePOST } from "@/app/api/admin/trackers/[id]/move/route";
import { POST as returnPOST } from "@/app/api/admin/trackers/[id]/return/route";
import { POST as retirePOST } from "@/app/api/admin/trackers/[id]/retire/route";
import { POST as simPOST } from "@/app/api/admin/sims/route";
import { POST as simBulkPOST } from "@/app/api/admin/sims/bulk/route";
import { PATCH as simPATCH } from "@/app/api/admin/sims/[id]/route";
import { POST as simLinkPOST } from "@/app/api/admin/sims/[id]/link/route";
import { GET as devicesGET } from "@/app/api/devices/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
// Valid IMEIs (check digit) for the tests.
const IMEI1 = "490154203237518";
const IMEI2 = "356938035643809";
const IMEI3 = "356938035643817";
const IMEI4 = "356938035643825";
const ICCID1 = "8901260123456789012";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA = "";
let orgB = "";
let device1 = "";
const traccarCalls: string[] = [];

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `192.0.2.${ipN++}` },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function req(method: string, who: string, body?: unknown) {
  return new Request(`${BASE}/x`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const p = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const pos = (imei: string, at: string): NormalizedPosition => ({ externalDeviceId: imei, imei, latitude: 34, longitude: -118, speedKph: 30, headingDeg: 0, altitudeM: 10, recordedAt: new Date(at), valid: true, ignition: true, motion: true });
const deviceRow = async (id: string) => (await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, id)))[0]!;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, sim_cards, gps_devices restart identity cascade`);
  clearOrganizationStatusCache();
  const [a] = await db.insert(schema.organizations).values({ name: "Acme Freight", slug: "acme" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Beta Logistics", slug: "beta" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, superAdmin: true });
  await createUserWithMembership({ email: "ann@acme.test", name: "Ann", password: PASSWORD, organizationSlug: "acme", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "bob@beta.test", name: "Bob", password: PASSWORD, organizationSlug: "beta", role: "ORG_ADMIN" });
  cookies.root = await signIn("root@platform.test");
  cookies.ann = await signIn("ann@acme.test");
  cookies.bob = await signIn("bob@beta.test");
  setTraccarAdminForTests({
    async ensureDevice(_n, uniqueId) {
      traccarCalls.push(uniqueId);
      return { device: { id: traccarCalls.length, uniqueId }, created: true };
    }
  });
});

afterAll(async () => {
  setTraccarAdminForTests(null);
  await closeDb();
});

describe("platform admins edit customers and manage their users", () => {
  it("edits name, short name, contact and display defaults; customers can't", async () => {
    expect((await customerPATCH(req("PATCH", "ann", { name: "Hacked" }), p({ id: orgA }))).status).toBe(403);
    const res = await customerPATCH(req("PATCH", "root", { name: "Acme Freight LLC", contactEmail: "Billing@Acme.test", contactPhone: "+1 805 555 0100", timeZone: "US/Pacific" }), p({ id: orgA }));
    expect(res.status).toBe(200);
    expect((await res.json()).changed.sort()).toEqual(["contactEmail", "contactPhone", "name", "timeZone"]);
    const [o] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.id, orgA));
    expect(o).toMatchObject({ name: "Acme Freight LLC", contactEmail: "billing@acme.test", timeZone: "America/Los_Angeles" });
    expect((await customerPATCH(req("PATCH", "root", { slug: "beta" }), p({ id: orgA }))).status).toBe(409);
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "customer.updated"));
    expect(JSON.stringify(audit!.metadata)).not.toContain("555");
  });

  it("adds a user, changes their role, resets their password and removes them", async () => {
    const add = await memberAddPOST(req("POST", "root", { email: "new@acme.test", name: "New", role: "VIEWER" }), p({ id: orgA }));
    expect(add.status).toBe(201);
    const { userId } = await add.json();
    expect((await memberPATCH(req("PATCH", "root", { role: "DISPATCHER" }), p({ id: orgA, userId }))).status).toBe(200);
    const [m] = await getDb().select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.organizationId, orgA)));
    expect(m!.role).toBe("DISPATCHER");
    const reset = await memberResetPOST(req("POST", "root"), p({ id: orgA, userId }));
    expect(reset.status).toBe(200);
    expect((await reset.json()).temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect((await memberDELETE(req("DELETE", "root"), p({ id: orgA, userId }))).status).toBe(204);
    // The last Org Admin can't be removed, even by a platform admin.
    const annId = (await getDb().select().from(schema.users).where(eq(schema.users.email, "ann@acme.test")))[0]!.id;
    expect((await memberDELETE(req("DELETE", "root"), p({ id: orgA, userId: annId }))).status).toBe(409);
    // A customer's own admin can't use these endpoints.
    expect((await memberAddPOST(req("POST", "ann", { email: "x@acme.test", name: "X", role: "VIEWER" }), p({ id: orgA }))).status).toBe(403);
  });
});

describe("tracker inventory: stock → customer → another customer → stock → retired", () => {
  it("adds a tracker to stock with its SIM; customers can't see it; it reports but stores nothing", async () => {
    const res = await stockPOST(req("POST", "root", { imei: IMEI1, model: "FTM880", iccid: ICCID1, serialNumber: "SN-1" }), p({}));
    expect(res.status).toBe(201);
    device1 = (await res.json()).deviceId;
    expect(traccarCalls).toContain(IMEI1);
    expect(await deviceRow(device1)).toMatchObject({ organizationId: null, providerId: null, serialNumber: "SN-1" });
    const [sim] = await getDb().select().from(schema.simCards).where(eq(schema.simCards.iccid, ICCID1));
    expect(sim).toMatchObject({ deviceId: device1, status: "inventory" });
    expect((await (await devicesGET(new Request(`${BASE}/api/devices`, { headers: { cookie: cookies.ann! } }))).json()).devices ?? []).toEqual([]);
    expect((await ingestPosition(pos(IMEI1, "2026-10-01T10:00:00Z"))).status).toBe("in_stock");
    expect((await deviceRow(device1)).lastSeenAt).not.toBeNull();
    expect((await stockPOST(req("POST", "root", { imei: IMEI1, model: "FTM880" }), p({}))).status).toBe(409);
  });

  it("assigns to a customer, which then stores positions", async () => {
    expect((await assignPOST(req("POST", "root", { organizationId: orgA, name: "Truck 7 tracker" }), p({ id: device1 }))).status).toBe(200);
    expect(await deviceRow(device1)).toMatchObject({ organizationId: orgA, name: "Truck 7 tracker", status: "active" });
    expect((await deviceRow(device1)).providerId).not.toBeNull();
    expect((await ingestPosition(pos(IMEI1, "2026-10-01T10:05:00Z"))).status).toBe("stored");
    expect((await assignPOST(req("POST", "root", { organizationId: orgB }), p({ id: device1 }))).status).toBe(409);
  });

  it("moves to another customer: history stays with the first, nothing of theirs follows the tracker", async () => {
    const [v] = await getDb().insert(schema.vehicles).values({ organizationId: orgA, name: "Truck 7" }).returning();
    await getDb().insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: device1, vehicleId: v!.id });
    expect((await movePOST(req("POST", "root", { organizationId: orgB, reason: "x" }), p({ id: device1 }))).status).toBe(400);
    expect((await movePOST(req("POST", "root", { organizationId: orgB, reason: "Sold to Beta" }), p({ id: device1 }))).status).toBe(200);
    expect(await deviceRow(device1)).toMatchObject({ organizationId: orgB, name: null });
    expect(await getDb().select().from(schema.deviceAssignments).where(and(eq(schema.deviceAssignments.deviceId, device1), isNull(schema.deviceAssignments.unassignedAt)))).toEqual([]);
    expect(await getDb().select().from(schema.currentLocations).where(eq(schema.currentLocations.deviceId, device1))).toEqual([]);
    const history = await getDb().select().from(schema.locationHistory).where(eq(schema.locationHistory.deviceId, device1));
    expect(history.map((h) => h.organizationId)).toEqual([orgA]);
    expect((await ingestPosition(pos(IMEI1, "2026-10-01T10:10:00Z"))).status).toBe("stored");
    const after = await getDb().select().from(schema.locationHistory).where(eq(schema.locationHistory.deviceId, device1));
    expect(after.map((h) => h.organizationId).sort()).toEqual([orgA, orgB].sort());
    const actions = (await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, device1))).map((a) => `${a.action}:${a.organizationId}`);
    expect(actions).toEqual(expect.arrayContaining([`device.moved_out:${orgA}`, `device.moved_in:${orgB}`]));
  });

  it("returns to stock and retires; retired trackers can't be assigned", async () => {
    expect((await returnPOST(req("POST", "root", { reason: "Customer cancelled" }), p({ id: device1 }))).status).toBe(200);
    expect(await deviceRow(device1)).toMatchObject({ organizationId: null, providerId: null, status: "active" });
    expect((await retirePOST(req("POST", "root", { retired: true, reason: "Water damage" }), p({ id: device1 }))).status).toBe(200);
    expect((await assignPOST(req("POST", "root", { organizationId: orgA }), p({ id: device1 }))).status).toBe(409);
    expect((await retirePOST(req("POST", "root", { retired: false, reason: "Repaired" }), p({ id: device1 }))).status).toBe(200);
  });

  it("registering a stock IMEI on a customer's page hands over that unit", async () => {
    const res = await devicesPOST(req("POST", "root", { imei: IMEI1, model: "FTM880" }), p({ id: orgA }));
    expect(res.status).toBe(201);
    expect((await res.json()).fromStock).toBe(true);
    expect((await deviceRow(device1)).organizationId).toBe(orgA);
  });

  it("bulk adds from a pasted list with SIMs, reporting each line", async () => {
    const res = await stockBulkPOST(req("POST", "root", { model: "FMC920", text: `${IMEI2}, 8901260123456789020, +18055550101\n${IMEI3}\n${IMEI1}\n123\n` }), p({}));
    const body = await res.json();
    expect(body.summary).toEqual({ added: 2, alreadyInStock: 0, withCustomer: 1, invalid: 1, failed: 0 });
    const [sim] = await getDb().select().from(schema.simCards).where(eq(schema.simCards.iccid, "8901260123456789020"));
    expect(sim!.msisdn).toBe("+18055550101");
  });
});

describe("SIMs", () => {
  it("adds, imports, links and flags SIMs that cost money for nothing", async () => {
    const add = await simPOST(req("POST", "root", { iccid: "8901 2601 2345 6789 038", msisdn: "805-555-0102", carrier: "AT&T", status: "active", monthlyCost: "4.50" }), p({}));
    expect(add.status).toBe(201);
    const { simId } = await add.json();
    expect((await simPOST(req("POST", "root", { iccid: "8901260123456789038" }), p({}))).status).toBe(409);
    expect((await simPOST(req("POST", "ann", { iccid: "8901260123456789046" }), p({}))).status).toBe(403);

    // Active, billed and in no tracker: flagged. So is the never-activated SIM in the tracker Acme now has.
    let list = await listSims(SimListQuery.parse({ view: "attention", sort: "iccid", direction: "asc" }));
    expect(list.items.map((s) => [s.iccid, s.attention])).toEqual([
      [ICCID1, "deployed_not_active"],
      ["8901260123456789038", "active_unused"]
    ]);
    expect(list.counts.wasted).toBe(450);

    // Put it in the tracker that is with Acme: no longer flagged; Acme's tracker's old SIM is replaced.
    const link = await simLinkPOST(req("POST", "root", { imei: IMEI1 }), p({ id: simId }));
    expect((await link.json()).replacedIccidLast4).toBe("9012");
    list = await listSims(SimListQuery.parse({ view: "attention" }));
    expect(list.items).toEqual([]);

    // Suspending the SIM of a tracker that is with a customer is flagged the other way.
    expect((await simPATCH(req("PATCH", "root", { status: "suspended" }), p({ id: simId }))).status).toBe(200);
    list = await listSims(SimListQuery.parse({ view: "attention" }));
    expect(list.items.map((s) => s.attention)).toEqual(["deployed_not_active"]);

    const bulk = await simBulkPOST(req("POST", "root", { text: `8901260123456789053, +18055550103, ${IMEI4}\n8901260123456789038\n`, carrier: "T-Mobile", status: "active", monthlyCost: 3 }), p({}));
    const b = await bulk.json();
    expect(b.summary).toMatchObject({ added: 1, alreadyListed: 1 });
    expect(b.results[0].message).toMatch(/not put in the tracker/);
  });

  it("the inventory list and overview count stock, customers and SIM problems", async () => {
    const t = await listPlatformTrackers(PlatformTrackerQuery.parse({}), 3900);
    expect(t.counts).toMatchObject({ all: 3, stock: 2, deployed: 1 });
    const stock = await listPlatformTrackers(PlatformTrackerQuery.parse({ state: "stock" }), 3900);
    expect(stock.items.every((i) => i.customer === null)).toBe(true);
    const bySim = await listPlatformTrackers(PlatformTrackerQuery.parse({ search: "8901260123456789038" }), 3900);
    expect(bySim.items.map((i) => i.imei)).toEqual([IMEI1]);
    const o = await getPlatformOverview(3900);
    expect(o.inventory).toMatchObject({ inStock: 2, simsDeployedNotActive: 1 });
  });
});
