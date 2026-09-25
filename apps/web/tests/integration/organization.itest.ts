import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as orgGET, PATCH as orgPATCH } from "@/app/api/organization/route";

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
