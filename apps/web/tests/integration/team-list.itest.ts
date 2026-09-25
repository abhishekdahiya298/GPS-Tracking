import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as teamGET } from "@/app/api/team/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;
async function signIn(email: string) {
  const res = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.2.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = async (qs: string, who = "admin") => (await teamGET(new Request(`${BASE}/api/team?${qs}`, { headers: { cookie: cookies[who]! } }))).json();

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]);
  await createUserWithMembership({ email: "admin@a.test", name: "Alice Admin", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  for (let i = 1; i <= 30; i++) await createUserWithMembership({ email: `driver${i}@a.test`, name: `Driver ${String(i).padStart(2, "0")}`, password: PASSWORD, organizationSlug: "org-a", role: i % 3 === 0 ? "DISPATCHER" : "VIEWER" });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob B", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookies.admin = await signIn("admin@a.test");
  cookies.bob = await signIn("bob@b.test");
});
afterAll(async () => {
  await closeDb();
});

describe("paged team list", () => {
  it("pages, counts by role and stays inside the organization", async () => {
    const b = await get("page=1&pageSize=10");
    expect(b.total).toBe(31);
    expect(b.items).toHaveLength(10);
    expect(b.counts).toMatchObject({ all: 31, ORG_ADMIN: 1, DISPATCHER: 10, VIEWER: 20 });
    expect(JSON.stringify(b)).not.toContain("bob@b.test");
    expect((await get("page=1", "bob")).total).toBe(1);
  });
  it("searches name/email (escaped), filters by role, sorts", async () => {
    expect((await get("search=driver1")).total).toBe(11); // driver1, driver10..19
    expect((await get("search=%25")).total).toBe(0);
    expect((await get("role=DISPATCHER")).total).toBe(10);
    const byRole = await get("sort=role&direction=asc&pageSize=10");
    expect(byRole.items[0].role).toBe("ORG_ADMIN");
    const active = await get("sort=lastActive&direction=desc&pageSize=10");
    expect(active.items[0].lastSignInAt).not.toBeNull(); // signed-in admin first; invited (never) last
  });
});
