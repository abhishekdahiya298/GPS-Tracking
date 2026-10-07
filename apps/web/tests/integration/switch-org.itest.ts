import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as orgsGET, POST as switchPOST } from "@/app/api/account/organization/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const orgs: Record<string, string> = {};
let cookie = "";
let other = "";

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip }, body: JSON.stringify({ email, password: PASSWORD }) }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const sw = (c: string, organizationId: unknown, origin = BASE) => switchPOST(new Request(`${BASE}/api/account/organization`, { method: "POST", headers: { cookie: c, origin, "content-type": "application/json" }, body: JSON.stringify({ organizationId }) }));
const names = async (c: string) => ((await (await vehiclesGET(new Request(`${BASE}/api/vehicles`, { headers: { cookie: c } }))).json()).vehicles as { name: string }[]).map((v) => v.name);

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const rows = await db.insert(schema.organizations).values([{ name: "Alpha Haulage", slug: "alpha" }, { name: "Beta Freight", slug: "beta" }, { name: "Gamma Lines", slug: "gamma" }]).returning();
  for (const r of rows) orgs[r.slug] = r.id;
  // One person, one account, two companies with different roles.
  const u = await createUserWithMembership({ email: "sam@x.test", name: "Sam", password: PASSWORD, organizationSlug: "alpha", role: "FLEET_MANAGER" });
  await db.insert(schema.memberships).values({ userId: u.userId, organizationId: orgs.beta!, role: "VIEWER" });
  await createUserWithMembership({ email: "gia@x.test", name: "Gia", password: PASSWORD, organizationSlug: "gamma", role: "ORG_ADMIN" });
  await db.insert(schema.vehicles).values([{ organizationId: orgs.alpha!, name: "Alpha truck" }, { organizationId: orgs.beta!, name: "Beta truck" }, { organizationId: orgs.gamma!, name: "Gamma truck" }]);
  cookie = await signIn("sam@x.test", "203.0.113.1");
  other = await signIn("sam@x.test", "203.0.113.2");
});

afterAll(async () => {
  await closeDb();
});

describe("one account in two companies", () => {
  it("lists only the companies the person belongs to, with the role in each", async () => {
    const body = await (await orgsGET(new Request(`${BASE}/api/account/organization`, { headers: { cookie } }))).json();
    expect(body.organizations).toEqual([
      { id: orgs.alpha, name: "Alpha Haulage", role: "FLEET_MANAGER" },
      { id: orgs.beta, name: "Beta Freight", role: "VIEWER" }
    ]);
  });

  it("starts in the first company and sees only its data", async () => {
    expect(await names(cookie)).toEqual(["Alpha truck"]);
  });

  it("switches to the other company for this session only, with that company's role", async () => {
    expect((await sw(cookie, orgs.beta)).status).toBe(200);
    expect(await names(cookie)).toEqual(["Beta truck"]);
    expect(await names(other)).toEqual(["Alpha truck"]);
    const { POST: vehiclesPOST } = await import("@/app/api/vehicles/route");
    const create = await vehiclesPOST(new Request(`${BASE}/api/vehicles`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "Nope" }) }));
    expect(create.status).toBe(403); // Viewer in Beta, although Fleet Manager in Alpha
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "auth.organization_switched"));
    expect(audit).toHaveLength(1);
  });

  it("refuses a company the person is not in, a missing one, bad input, cross-site and signed-out requests", async () => {
    expect((await sw(cookie, orgs.gamma)).status).toBe(404);
    expect((await sw(cookie, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await sw(cookie, "gamma")).status).toBe(400);
    expect((await sw(cookie, orgs.alpha, "https://evil.test")).status).toBe(403);
    expect((await sw("", orgs.alpha)).status).toBe(401);
    expect(await names(cookie)).toEqual(["Beta truck"]);
  });

  it("falls back to a company the person still belongs to when removed from the active one", async () => {
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "sam@x.test"));
    await getDb().delete(schema.memberships).where(sql`user_id = ${u!.id} and organization_id = ${orgs.beta}`);
    expect(await names(cookie)).toEqual(["Alpha truck"]);
  });
});
