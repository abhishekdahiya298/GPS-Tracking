import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as orgGET, PATCH as orgPATCH } from "@/app/api/organization/route";
import { GET as prefsGET, PATCH as prefsPATCH } from "@/app/api/account/preferences/route";
import { getTimePrefs } from "@/lib/organization";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.0.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, who: string, body?: unknown, origin = BASE) =>
  new Request(`${BASE}/api/organization`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]);
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER") => createUserWithMembership({ email, name: email, password: PASSWORD, organizationSlug: slug, role });
  await mk("admin@a.test", "org-a", "ORG_ADMIN");
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("bob@b.test", "org-b", "ORG_ADMIN");
  for (const [k, e] of [["admin", "admin@a.test"], ["fleet", "fleet@a.test"], ["bob", "bob@b.test"]] as const) cookies[k] = await signIn(e);
});
afterAll(async () => {
  await closeDb();
});

describe("organization settings", () => {
  it("new organizations default to imperial (US)", async () => {
    const body = await (await orgGET(req("GET", "fleet"))).json();
    expect(body).toMatchObject({ name: "Org A", unitSystem: "imperial" });
  });

  it("only Org Admins can change settings, only for their own organization", async () => {
    expect((await orgPATCH(req("PATCH", "fleet", { unitSystem: "metric" }))).status).toBe(403);
    expect((await orgPATCH(req("PATCH", "admin", { unitSystem: "metric" }, "https://evil.example"))).status).toBe(403);
    expect((await orgPATCH(req("PATCH", "admin", { unitSystem: "furlongs" }))).status).toBe(400);
    expect((await orgPATCH(req("PATCH", "admin", { unitSystem: "metric" }))).status).toBe(200);
    const rows = await getDb().select({ slug: schema.organizations.slug, u: schema.organizations.unitSystem }).from(schema.organizations);
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.u]))).toEqual({ "org-a": "metric", "org-b": "imperial" });
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "organization.settings_updated"));
    expect(audit!.metadata).toMatchObject({ unitSystem: { from: "imperial", to: "metric" } });
  });

  it("an organizationId in the body is ignored (tenant comes from the session)", async () => {
    const [b] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    const res = await orgPATCH(req("PATCH", "admin", { unitSystem: "imperial", organizationId: b!.id }));
    expect(res.status).toBe(200);
    const [bAfter] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    expect(bAfter!.unitSystem).toBe("imperial");
    const [aAfter] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-a"));
    expect(aAfter!.unitSystem).toBe("imperial");
  });
});

const prefsReq = (method: string, who: string, body?: unknown, origin = BASE) =>
  new Request(`${BASE}/api/account/preferences`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
const orgId = async (slug: string) => (await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, slug)))[0]!.id;
const userId = async (email: string) => (await getDb().select().from(schema.users).where(eq(schema.users.email, email)))[0]!.id;

describe("organization time zone and clock", () => {
  it("defaults: Eastern (Toronto), 12-hour", async () => {
    const body = await (await orgGET(req("GET", "fleet"))).json();
    expect(body).toMatchObject({ timeZone: "America/Toronto", timeFormat: "12h" });
  });

  it("Org Admin can set them; zones are validated and stored canonically; audited", async () => {
    expect((await orgPATCH(req("PATCH", "fleet", { timeZone: "America/Vancouver" }))).status).toBe(403);
    expect((await orgPATCH(req("PATCH", "admin", { timeZone: "Mars/Olympus" }))).status).toBe(400);
    expect((await orgPATCH(req("PATCH", "admin", { timeZone: "America/Toronto'; drop table users;--" }))).status).toBe(400);
    expect((await orgPATCH(req("PATCH", "admin", { timeFormat: "36h" }))).status).toBe(400);
    expect((await orgPATCH(req("PATCH", "admin", { timeZone: "US/Pacific", timeFormat: "24h" }))).status).toBe(200);
    const body = await (await orgGET(req("GET", "admin"))).json();
    expect(body).toMatchObject({ timeZone: "America/Los_Angeles", timeFormat: "24h" });
    const [bob] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    expect(bob!.timeZone).toBe("America/Toronto"); // other tenant untouched
    const audits = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "organization.settings_updated"));
    expect(audits.at(-1)!.metadata).toEqual({ timeZone: { from: "America/Toronto", to: "America/Los_Angeles" }, timeFormat: { from: "12h", to: "24h" } });
  });
});

describe("personal time preferences", () => {
  it("start empty (= organization default) and resolve to the organization's", async () => {
    expect(await (await prefsGET(prefsReq("GET", "fleet"))).json()).toEqual({ timeZone: null, timeFormat: null });
    expect(await getTimePrefs(await orgId("org-a"), await userId("fleet@a.test"))).toEqual({ timeZone: "America/Los_Angeles", timeFormat: "24h" });
  });

  it("any member can set their own; the user comes from the session, never the body", async () => {
    expect((await prefsPATCH(prefsReq("PATCH", "fleet", { timeZone: "America/Regina" }, "https://evil.example"))).status).toBe(403);
    expect((await prefsPATCH(prefsReq("PATCH", "fleet", { timeZone: "Nowhere/Land" }))).status).toBe(400);
    const bobId = await userId("bob@b.test");
    expect((await prefsPATCH(prefsReq("PATCH", "fleet", { timeZone: "america/regina", timeFormat: "12h", userId: bobId }))).status).toBe(200);
    expect(await (await prefsGET(prefsReq("GET", "fleet"))).json()).toEqual({ timeZone: "America/Regina", timeFormat: "12h" });
    expect(await (await prefsGET(prefsReq("GET", "bob"))).json()).toEqual({ timeZone: null, timeFormat: null });
    expect(await getTimePrefs(await orgId("org-a"), await userId("fleet@a.test"))).toEqual({ timeZone: "America/Regina", timeFormat: "12h" });
    // admin still follows the organization
    expect(await getTimePrefs(await orgId("org-a"), await userId("admin@a.test"))).toEqual({ timeZone: "America/Los_Angeles", timeFormat: "24h" });
  });

  it("null goes back to the organization default", async () => {
    expect((await prefsPATCH(prefsReq("PATCH", "fleet", { timeZone: null, timeFormat: null }))).status).toBe(200);
    expect(await getTimePrefs(await orgId("org-a"), await userId("fleet@a.test"))).toEqual({ timeZone: "America/Los_Angeles", timeFormat: "24h" });
  });

  it("requires sign-in", async () => {
    const res = await prefsPATCH(new Request(`${BASE}/api/account/preferences`, { method: "PATCH", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ timeZone: "UTC" }) }));
    expect(res.status).toBe(401);
  });
});
