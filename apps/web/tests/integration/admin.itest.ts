import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { requireTenantContext } from "@/lib/authz";
import { setTraccarAdminForTests, type TraccarAdmin } from "@/lib/traccar";
import { POST as devicesPOST } from "@/app/api/admin/customers/[id]/devices/route";
import { GET as customersGET, POST as customersPOST } from "@/app/api/admin/customers/route";
import { POST as viewAsPOST } from "@/app/api/admin/view-as/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${ipN++}` },
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

const traccarCalls: Array<{ name: string; uniqueId: string }> = [];
let traccarFails = false;
const fakeTraccar: TraccarAdmin = {
  async ensureDevice(name, uniqueId) {
    if (traccarFails) throw new Error("connect ECONNREFUSED");
    traccarCalls.push({ name, uniqueId });
    return { device: { id: 100 + traccarCalls.length, uniqueId }, created: true };
  }
};

let customerId = "";

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Platform", slug: "platform" }, { name: "Org B", slug: "org-b" }]);
  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, organizationSlug: "platform", role: "ORG_ADMIN", superAdmin: true });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookies.root = await signIn("root@platform.test");
  cookies.bob = await signIn("bob@b.test");
  setTraccarAdminForTests(fakeTraccar);
});

afterAll(async () => {
  setTraccarAdminForTests(null);
  await closeDb();
});

describe("admin: access control", () => {
  it("org admins (non super admin) get 403 on every admin endpoint", async () => {
    expect((await customersGET(req("GET", "/api/admin/customers", "bob"))).status).toBe(403);
    expect((await customersPOST(req("POST", "/api/admin/customers", "bob", { name: "X Co", slug: "x-co", admin: { email: "x@x.test", name: "X" } }))).status).toBe(403);
    const [b] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    expect((await devicesPOST(req("POST", "/", "bob", { imei: IMEI, model: "FTM880" }), p(b!.id))).status).toBe(403);
    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "bob", { organizationId: b!.id }))).status).toBe(403);
    expect(traccarCalls).toHaveLength(0);
  });

  it("anonymous requests are 401 and cross-origin writes are rejected", async () => {
    expect((await customersGET(new Request(`${BASE}/api/admin/customers`))).status).toBe(401);
    const res = await customersPOST(req("POST", "/api/admin/customers", "root", { name: "Evil", slug: "evil", admin: { email: "e@e.test", name: "E" } }, "https://evil.example"));
    expect(res.status).toBe(403);
  });
});

describe("admin: onboarding", () => {
  it("creates a customer with a first Org Admin who can sign in", async () => {
    const res = await customersPOST(req("POST", "/api/admin/customers", "root", { name: "Acme Logistics", slug: "acme", admin: { email: "Boss@Acme.test", name: "Boss" } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    customerId = body.organizationId;
    expect(body.admin.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/); // email disabled in tests
    const [m] = await getDb()
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.users.email, "boss@acme.test"));
    expect(m!.role).toBe("ORG_ADMIN");
    const dup = await customersPOST(req("POST", "/api/admin/customers", "root", { name: "Acme 2", slug: "acme", admin: { email: "z@z.test", name: "Z" } }));
    expect(dup.status).toBe(409);
    const list = await (await customersGET(req("GET", "/api/admin/customers", "root"))).json();
    expect(list.customers.find((c: { slug: string }) => c.slug === "acme")).toMatchObject({ members: 1, devices: 0 });
  });

  it("validates the IMEI check digit before touching Traccar", async () => {
    const res = await devicesPOST(req("POST", "/", "root", { imei: "864361078566116", model: "FTM880" }), p(customerId));
    expect(res.status).toBe(400);
    expect(traccarCalls).toHaveLength(0);
  });

  it("saves nothing if Traccar registration fails", async () => {
    traccarFails = true;
    const res = await devicesPOST(req("POST", "/", "root", { imei: IMEI, model: "FTM880" }), p(customerId));
    traccarFails = false;
    expect(res.status).toBe(502);
    expect(await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, IMEI))).toHaveLength(0);
  });

  it("registers a device in Traccar and RIO, then refuses duplicates", async () => {
    const res = await devicesPOST(req("POST", "/", "root", { imei: IMEI, model: "FTM880" }), p(customerId));
    expect(res.status).toBe(201);
    expect(traccarCalls).toEqual([{ name: "FTM880-6115", uniqueId: IMEI }]);
    const [d] = await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.imei, IMEI));
    expect(d!.organizationId).toBe(customerId);
    const [b] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    expect((await devicesPOST(req("POST", "/", "root", { imei: IMEI, model: "FTM880" }), p(b!.id))).status).toBe(409);
    expect((await devicesPOST(req("POST", "/", "root", { imei: IMEI, model: "FTM880" }), p("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "device.registered"));
    expect(JSON.stringify(audit!.metadata)).not.toContain(IMEI);
  });
});

describe("admin: view as customer", () => {
  it("super admin can switch into a customer and back; it is audited", async () => {
    const ctx0 = await requireTenantContext(req("GET", "/", "root"));
    const [platform] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "platform"));
    expect(ctx0.organizationId).toBe(platform!.id);

    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "root", { organizationId: customerId }))).status).toBe(200);
    const ctx = await requireTenantContext(req("GET", "/", "root"));
    expect(ctx).toMatchObject({ organizationId: customerId, role: null, isSuperAdmin: true });
    expect((await vehiclesGET(req("GET", "/api/vehicles", "root"))).status).toBe(200);

    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "root", { organizationId: null }))).status).toBe(200);
    expect((await requireTenantContext(req("GET", "/", "root"))).organizationId).toBe(platform!.id);
    const actions = (await getDb().select({ a: schema.auditLogs.action }).from(schema.auditLogs)).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["admin.view_as_started", "admin.view_as_ended"]));
  });

  it("a normal user whose session points at a foreign org still acts only in their own", async () => {
    const [b] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    await getDb().execute(sql`update sessions set active_organization_id = ${customerId} where user_id = (select id from users where email = 'bob@b.test')`);
    expect((await requireTenantContext(req("GET", "/", "bob"))).organizationId).toBe(b!.id);
  });

  it("view-as a non-existent org is 404", async () => {
    expect((await viewAsPOST(req("POST", "/api/admin/view-as", "root", { organizationId: "00000000-0000-4000-8000-000000000000" }))).status).toBe(404);
  });
});
