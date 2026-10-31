import "./setup-env";
import type { NormalizedPosition } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { requireTenantContext } from "@/lib/authz";
import { createCustomer, listCustomersPage, CustomerListQuery } from "@/lib/customers";
import { OrganizationUnavailableError, PlatformOnlyError } from "@/lib/errors";
import { ingestPosition } from "@/lib/ingest";
import { listMyOrganizations } from "@/lib/my-organizations";
import { clearOrganizationStatusCache } from "@/lib/organization-status";
import { ActivityQuery, getPlatformOverview, listActivity, listPlatformTrackers, PlatformTrackerQuery } from "@/lib/platform";
import { createShareLink, viewShareLink } from "@/lib/share-links";
import { setTraccarAdminForTests } from "@/lib/traccar";
import { POST as statusPOST } from "@/app/api/admin/customers/[id]/status/route";
import { POST as devicesPOST } from "@/app/api/admin/customers/[id]/devices/route";
import { POST as viewAsPOST } from "@/app/api/admin/view-as/route";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA = "";
let orgB = "";
let vehicleA = "";
const meta = { ipAddress: null, userAgent: null };

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.51.100.${ipN++}` },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function req(method: string, path: string, who: string, body?: unknown) {
  return new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const setStatus = (who: string, id: string, body: unknown) => statusPOST(req("POST", `/api/admin/customers/${id}/status`, who, body), p(id));

const pos = (recordedAt: string): NormalizedPosition => ({
  externalDeviceId: IMEI,
  imei: IMEI,
  latitude: 34.05,
  longitude: -118.24,
  speedKph: 40,
  headingDeg: 90,
  altitudeM: 80,
  recordedAt: new Date(recordedAt),
  valid: true,
  ignition: true,
  motion: true
});

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  clearOrganizationStatusCache();
  const [a] = await db.insert(schema.organizations).values({ name: "Acme Freight", slug: "acme" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Beta Logistics", slug: "beta" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  const [prov] = await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning();
  const [dev] = await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: prov!.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880" }).returning();
  const [v] = await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Truck 1" }).returning();
  vehicleA = v!.id;
  await db.insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: dev!.id, vehicleId: vehicleA });

  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, superAdmin: true });
  await createUserWithMembership({ email: "admin@acme.test", name: "Ann", password: PASSWORD, organizationSlug: "acme", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "both@acme.test", name: "Both", password: PASSWORD, organizationSlug: "acme", role: "VIEWER" });
  await db.insert(schema.memberships).values({ userId: (await db.select().from(schema.users).where(eq(schema.users.email, "both@acme.test")))[0]!.id, organizationId: orgB, role: "VIEWER" });
  cookies.root = await signIn("root@platform.test");
  cookies.ann = await signIn("admin@acme.test");
  cookies.both = await signIn("both@acme.test");
  setTraccarAdminForTests({ async ensureDevice(_n, uniqueId) { return { device: { id: 1, uniqueId }, created: true }; } });
});

afterAll(async () => {
  setTraccarAdminForTests(null);
  await closeDb();
});

describe("platform admins are not organization members", () => {
  it("the CLI creates a platform admin with no membership, and they act nowhere until they choose a customer", async () => {
    const [root] = await getDb().select().from(schema.users).where(eq(schema.users.email, "root@platform.test"));
    expect(await getDb().select().from(schema.memberships).where(eq(schema.memberships.userId, root!.id))).toEqual([]);
    await expect(requireTenantContext(req("GET", "/", "root"))).rejects.toBeInstanceOf(PlatformOnlyError);
  });

  it("platform search works without a customer open (customers only)", async () => {
    const res = await searchGET(req("GET", "/api/search?q=acme", "root"));
    expect(res.status).toBe(200);
    const { hits } = await res.json();
    expect(hits.map((h: { group: string; title: string }) => `${h.group}:${h.title}`)).toEqual(["customers:Acme Freight"]);
  });

  it("a new customer can't be given a platform admin as its administrator (and nothing is created)", async () => {
    await expect(createCustomer("x", { name: "Gamma", slug: "gamma", admin: { email: "root@platform.test", name: "Root" }, timeZone: "America/Toronto", unitSystem: "imperial" }, meta)).rejects.toThrow(/platform admin/);
    expect(await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "gamma"))).toEqual([]);
  });
});

describe("customer status: suspend, archive (soft delete), restore", () => {
  it("only platform admins can change it; a reason is required to suspend or archive", async () => {
    expect((await setStatus("ann", orgA, { status: "suspended", reason: "unpaid" })).status).toBe(403);
    expect((await setStatus("root", orgA, { status: "suspended" })).status).toBe(400);
    expect((await setStatus("root", orgA, { status: "active" })).status).toBe(409);
  });

  it("suspending blocks the customer's users but keeps storing tracker positions", async () => {
    const annId = (await getDb().select().from(schema.users).where(eq(schema.users.email, "admin@acme.test")))[0]!.id;
    const token = (await createShareLink({ userId: annId, organizationId: orgA, role: "ORG_ADMIN", isSuperAdmin: false }, { vehicleId: vehicleA, hours: 24, label: null }, meta)).token;
    expect(await viewShareLink(token)).not.toBeNull();

    expect((await setStatus("root", orgA, { status: "suspended", reason: "Invoice 1042 unpaid" })).status).toBe(200);
    await expect(requireTenantContext(req("GET", "/", "ann"))).rejects.toBeInstanceOf(OrganizationUnavailableError);
    expect((await vehiclesGET(req("GET", "/api/vehicles", "ann"))).status).toBe(403);
    // Someone in two companies keeps working in the other one; the switcher hides the suspended one.
    expect((await requireTenantContext(req("GET", "/", "both"))).organizationId).toBe(orgB);
    const bothId = (await getDb().select().from(schema.users).where(eq(schema.users.email, "both@acme.test")))[0]!.id;
    expect((await listMyOrganizations(bothId)).map((o) => o.id)).toEqual([orgB]);
    // Public links answer like unknown ones.
    expect(await viewShareLink(token)).toBeNull();
    // History is kept while suspended.
    expect((await ingestPosition(pos("2026-10-01T10:00:00Z"))).status).toBe("stored");

    const [org] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.id, orgA));
    expect(org).toMatchObject({ status: "suspended", statusReason: "Invoice 1042 unpaid" });
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "customer.suspended"));
    expect(audit!.metadata).toMatchObject({ from: "active", to: "suspended", reason: "Invoice 1042 unpaid" });
  });

  it("a platform admin can still open a suspended customer", async () => {
    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "root", { organizationId: orgA }))).status).toBe(200);
    expect(await requireTenantContext(req("GET", "/", "root"))).toMatchObject({ organizationId: orgA, role: null, isSuperAdmin: true });
    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "root", { organizationId: null }))).status).toBe(200);
  });

  it("archiving stops storing positions and new trackers; it is hidden from the current list", async () => {
    expect((await setStatus("root", orgA, { status: "archived", reason: "Cancelled subscription" })).status).toBe(200);
    expect((await ingestPosition(pos("2026-10-01T10:05:00Z"))).status).toBe("customer_archived");
    const devRes = await devicesPOST(req("POST", "/", "root", { imei: "490154203237518", model: "FTM880" }), p(orgA));
    expect(devRes.status).toBe(409);

    const current = await listCustomersPage(CustomerListQuery.parse({}));
    expect(current.items.map((c) => c.name)).toEqual(["Beta Logistics"]);
    expect(current.counts).toEqual({ current: 1, suspended: 0, archived: 1, all: 2 });
    const archived = await listCustomersPage(CustomerListQuery.parse({ view: "archived" }));
    expect(archived.items).toEqual([expect.objectContaining({ name: "Acme Freight", status: "archived", statusReason: "Cancelled subscription" })]);
    // Nothing was deleted.
    expect((await getDb().select().from(schema.vehicles).where(eq(schema.vehicles.organizationId, orgA))).length).toBe(1);
    expect((await getDb().select().from(schema.memberships).where(eq(schema.memberships.organizationId, orgA))).length).toBe(2);
  });

  it("restoring brings everything back", async () => {
    expect((await setStatus("root", orgA, { status: "active" })).status).toBe(200);
    expect((await requireTenantContext(req("GET", "/", "ann"))).organizationId).toBe(orgA);
    expect((await ingestPosition(pos("2026-10-01T10:10:00Z"))).status).toBe("stored");
    const [org] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.id, orgA));
    expect(org).toMatchObject({ status: "active", statusReason: null });
    const actions = (await getDb().select({ a: schema.auditLogs.action }).from(schema.auditLogs)).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["customer.suspended", "customer.archived", "customer.restored"]));
  });
});

describe("platform console read models", () => {
  it("overview, trackers and activity cover every customer", async () => {
    const o = await getPlatformOverview(3900);
    expect(o.customers).toMatchObject({ active: 2, suspended: 0, archived: 0 });
    // The tracker just reported (last seen is the time it was received).
    expect(o.trackers).toMatchObject({ total: 1, online: 1, silent24h: 0, never: 0 });
    expect(o.attention.map((a) => `${a.name}:${a.issue}`)).toContain("Beta Logistics:no_trackers");

    const t = await listPlatformTrackers(PlatformTrackerQuery.parse({ search: "6115" }), 3900);
    expect(t.items).toEqual([expect.objectContaining({ customerName: "Acme Freight", imeiLast4: "6115" })]);
    expect(JSON.stringify(t)).not.toContain(IMEI);

    const a = await listActivity(ActivityQuery.parse({ kind: "customers" }));
    expect(a.items.map((r) => r.action)).toEqual(["customer.restored", "customer.archived", "customer.suspended"]);
    expect(a.items.every((r) => r.actorIsPlatform && r.customerName === "Acme Freight")).toBe(true);
  });
});
