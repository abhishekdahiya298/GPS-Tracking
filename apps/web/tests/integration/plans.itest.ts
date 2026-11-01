import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { resolveTenantContext } from "@/lib/authz";
import { createCustomer } from "@/lib/customers";
import { listPlans, periodOf, recordTrackerMonths, setCustomerPlan, updatePlan, usageStatement, loadAllowanceNotice } from "@/lib/plans";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";
import { POST as createLoadPOST } from "@/app/api/loads/route";
import { DELETE as loadDELETE, PATCH as loadPATCH } from "@/app/api/loads/[id]/route";
import { POST as statusPOST } from "@/app/api/loads/[id]/status/route";
import { POST as driverActionPOST } from "@/app/api/driver/action/route";
import { GET as billingCsvGET } from "@/app/api/admin/billing/route";
import { POST as customerPlanPOST } from "@/app/api/admin/customers/[id]/plan/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;
const meta = { ipAddress: null, userAgent: null };

const PICKUP = { name: "Acme DC", address: "100 Front St W, Toronto, ON", latitude: 43.6453, longitude: -79.3806, radiusM: 500, appointmentAt: null };
const DELIVERY = { name: null, address: "1 Rue Notre-Dame, Montreal, QC", latitude: 45.5048, longitude: -73.5566, radiusM: 500, appointmentAt: null };
const newLoad = (reference: string) => ({ reference, driverName: "Sam", driverPhone: "(416) 555-0123", pickup: PICKUP, delivery: DELIVERY });

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.9.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pub = (path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipN++}`, "user-agent": "DriverPhone/1.0" }, body: JSON.stringify(body) });

let platformId = "";
let brokerId = "";
let brokerAdminId = "";
const planIds: Record<string, string> = {};

async function createLoad(who: string, reference: string) {
  const res = await createLoadPOST(req("POST", "/api/loads", who, newLoad(reference)));
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string; driverLink: string };
  return { id: json.id, token: json.driverLink.split("#")[1]! };
}
const accept = (token: string) => driverActionPOST(pub("/api/driver/action", { token, action: "accept" }));

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, billable_loads, billable_trackers restart identity cascade`);
  for (const pl of await listPlans()) planIds[pl.name] = pl.id;
  const [pf] = await db.insert(schema.users).values({ email: "root@rio.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  platformId = pf!.id;
  // A broker on the Loads Starter plan, created through the console path.
  const created = await createCustomer(platformId, { name: "Northbound Brokerage", slug: "northbound", timeZone: "America/Toronto", unitSystem: "metric", planId: planIds["Loads Starter"], admin: { email: "owner@northbound.test", name: "Owner" } }, meta);
  brokerId = created.organizationId;
  await createUserWithMembership({ email: "dispatch@northbound.test", name: "Dispatch", password: PASSWORD, organizationSlug: "northbound", role: "DISPATCHER" });
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "owner@northbound.test"));
  brokerAdminId = owner!.id;
  cookies.dispatch = await signIn("dispatch@northbound.test");
  await createUserWithMembership({ email: "root2@rio.test", name: "Root Two", password: PASSWORD, organizationSlug: "northbound", role: "VIEWER" });
  await db.update(schema.users).set({ isSuperAdmin: true }).where(eq(schema.users.email, "root2@rio.test"));
  cookies.root = await signIn("root2@rio.test");
});
afterAll(async () => {
  await closeDb();
});

describe("plans: what a customer can use", () => {
  it("a new customer starts on the chosen plan; the request context carries its modules", async () => {
    const ctx = await resolveTenantContext({ userId: brokerAdminId, isSuperAdmin: false, activeOrganizationId: null } as never);
    expect(ctx.modules).toEqual(["loads"]);
    expect((await listPlans()).find((x) => x.name === "Loads Starter")!.customers).toBe(1);
  });

  it("Loads-only: fleet APIs answer 403, loads work, and a load can't be tracked by an own vehicle", async () => {
    expect((await vehiclesGET(req("GET", "/api/vehicles", "dispatch"))).status).toBe(403);
    const res = await createLoadPOST(req("POST", "/api/loads", "dispatch", { ...newLoad("V-1"), trackingMode: "vehicle", vehicleId: "00000000-0000-4000-8000-000000000000", driverPhone: null }));
    expect([400, 403, 422]).toContain(res.status);
    expect(JSON.stringify(await res.json())).toMatch(/GPS plan/);
  });
});

describe("plans: counting loads fairly", () => {
  it("a load counts once when tracking starts; untracked and cancelled loads are free; deleting doesn't uncount", async () => {
    const a = await createLoad("dispatch", "L-1");
    const b = await createLoad("dispatch", "L-2");
    const period = periodOf(new Date(), "America/Toronto");
    const used = async () => (await usageStatement(period, brokerId))[0]!.loadsUsed;
    expect(await used()).toBe(0); // created, not tracking yet

    expect((await accept(a.token)).status).toBe(200);
    expect((await accept(a.token)).status).toBe(200); // accepting again (or resuming) doesn't count twice
    expect(await used()).toBe(1);

    // Never tracked, then cancelled: free.
    expect((await statusPOST(req("POST", `/api/loads/${b.id}/status`, "dispatch", { action: "cancel" }), p(b.id))).status).toBeLessThan(300);
    expect(await used()).toBe(1);

    // Tracked, then deleted: still counted in the month it was used.
    expect((await loadDELETE(req("DELETE", `/api/loads/${a.id}`, "dispatch"), p(a.id))).status).toBeLessThan(300);
    expect(await used()).toBe(1);
  });

  it("after pickup the pickup can't be moved (a new shipment is a new load)", async () => {
    const c = await createLoad("dispatch", "L-3");
    await accept(c.token);
    await getDb().update(schema.loads).set({ status: "in_transit" }).where(eq(schema.loads.id, c.id));
    const res = await loadPATCH(req("PATCH", `/api/loads/${c.id}`, "dispatch", { pickup: { ...PICKUP, address: "Somewhere else", latitude: 44, longitude: -79 } }), p(c.id));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/new load/);
  });

  it("over the allowance work continues, extra loads are billed, and the Loads page warns", async () => {
    // Custom terms for this customer: 2 included loads, $2.00 per extra, $49 a month.
    await setCustomerPlan(platformId, brokerId, { planId: planIds["Loads Starter"]!, modules: ["loads"], includedLoads: 2, extraLoad: 200, monthlyFee: 4900, perTracker: 0, note: "trial" }, meta);
    expect(await loadAllowanceNotice(brokerId)).toMatchObject({ used: 2, included: 2, level: "over" });
    const d = await createLoad("dispatch", "L-4");
    expect((await accept(d.token)).status).toBe(200);
    const [line] = await usageStatement(periodOf(new Date(), "America/Toronto"), brokerId);
    expect(line).toMatchObject({ loadsUsed: 3, extraLoads: 1, amounts: { monthlyFeeCents: 4900, extraLoadsCents: 200, totalCents: 5100 } });
    expect(line!.plan).toMatchObject({ planName: "Loads Starter", includedLoads: 2 });
  });

  it("editing a catalog plan never changes an existing customer's price", async () => {
    await updatePlan(platformId, planIds["Loads Starter"]!, { name: "Loads Starter", modules: ["loads"], includedLoads: 50, extraLoad: 999, monthlyFee: 99_900, perTracker: 0, active: true }, meta);
    const [line] = await usageStatement(periodOf(new Date(), "America/Toronto"), brokerId);
    expect(line!.plan).toMatchObject({ includedLoads: 2, extraLoadCents: 200, monthlyFeeCents: 4900 });
  });
});

describe("plans: trackers and switching plans", () => {
  it("adding GPS opens the fleet pages; a tracker counts once per month", async () => {
    const res = await customerPlanPOST(req("POST", `/api/admin/customers/${brokerId}/plan`, "root", { planId: planIds["GPS + Loads"], modules: ["gps", "loads"], includedLoads: 2, extraLoad: 2, monthlyFee: 49, perTracker: 19.99 }), p(brokerId));
    expect(res.status).toBe(204);
    expect((await vehiclesGET(req("GET", "/api/vehicles", "dispatch"))).status).toBe(200);
    // Only platform admins can change plans.
    expect((await customerPlanPOST(req("POST", `/api/admin/customers/${brokerId}/plan`, "dispatch", { planId: planIds["GPS"], modules: ["gps"], includedLoads: 0, extraLoad: 0, monthlyFee: 0, perTracker: 0 }), p(brokerId))).status).toBe(403);

    const db = getDb();
    const [prov] = await db.select().from(schema.gpsProviders).where(eq(schema.gpsProviders.organizationId, brokerId));
    await db.insert(schema.gpsDevices).values({ organizationId: brokerId, providerId: prov!.id, externalDeviceId: "864361078566115", imei: "864361078566115" });
    expect(await recordTrackerMonths()).toBe(1);
    expect(await recordTrackerMonths()).toBe(0);
    const [line] = await usageStatement(periodOf(new Date(), "America/Toronto"), brokerId);
    expect(line).toMatchObject({ trackers: 1, amounts: { trackersCents: 1999, monthlyFeeCents: 4900, extraLoadsCents: 200, totalCents: 4900 + 1999 + 200 } });
  });

  it("the statement CSV is for platform admins only", async () => {
    const month = periodOf(new Date(), "America/Toronto");
    expect((await billingCsvGET(req("GET", `/api/admin/billing?month=${month}`, "dispatch"))).status).toBe(403);
    const res = await billingCsvGET(req("GET", `/api/admin/billing?month=${month}`, "root"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("loads_included");
    expect(csv).toContain("Northbound Brokerage");
  });
});
