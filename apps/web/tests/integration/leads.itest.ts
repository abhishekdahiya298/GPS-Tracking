import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { listLeads } from "@/lib/leads";
import { PATCH as leadPATCH } from "@/app/api/admin/leads/[id]/route";
import { POST as leadsPOST } from "@/app/api/leads/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
const sent: EmailMessage[] = [];
let ipN = 1;
/** Unique per run: the rate limit counts per address per hour in Redis, which outlives a test run. */
const RUN = Date.now().toString(16);
const ip = (n: number) => `2001:db8:${RUN.slice(-8, -4)}:${RUN.slice(-4)}::${n}`;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
/** A public request (no cookie) from a given address. */
function pub(body: unknown, ip: string, origin: string | null = BASE) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  return new Request(`${BASE}/api/leads`, { method: "POST", headers, body: JSON.stringify(body) });
}
function patch(id: string, who: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE };
  if (who) headers.cookie = cookies[who]!;
  return [new Request(`${BASE}/api/admin/leads/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }] as const;
}
const GOOD = { name: " Dana Fox ", company: "Fox Haulage", email: "Dana@Fox.test", phone: "416 555 0100", fleetSize: "6-20", country: "CA", message: "<b>Need 12 trackers</b>" };

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate leads, audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Platform", slug: "platform" }, { name: "Org B", slug: "org-b" }]);
  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, organizationSlug: "platform", role: "ORG_ADMIN", superAdmin: true });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookies.root = await signIn("root@platform.test");
  cookies.bob = await signIn("bob@b.test");
  setEmailTransportForTests(async (m) => void sent.push(m));
});

afterAll(async () => {
  setEmailTransportForTests(null);
  await closeDb();
});

describe("public pricing requests", () => {
  it("stores a valid request without a session and emails platform admins only", async () => {
    const res = await leadsPOST(pub(GOOD, ip(1)));
    expect(res.status).toBe(201);
    const { leads, newCount } = await listLeads();
    expect(newCount).toBe(1);
    expect(leads[0]).toMatchObject({ name: "Dana Fox", company: "Fox Haulage", email: "dana@fox.test", fleetSize: "6-20", country: "CA", status: "new" });
    expect(sent.map((m) => m.to)).toEqual(["root@platform.test"]);
    // The message is user input: escaped in the HTML email.
    expect(sent[0]!.html).toContain("&lt;b&gt;Need 12 trackers&lt;/b&gt;");
    expect(sent[0]!.html).not.toContain("<b>Need");
  });

  it("rejects bad input and cross-site posts", async () => {
    expect((await leadsPOST(pub({ ...GOOD, email: "nope" }, ip(2)))).status).toBe(400);
    expect((await leadsPOST(pub({ ...GOOD, fleetSize: "1000000" }, ip(2)))).status).toBe(400);
    expect((await leadsPOST(pub({ ...GOOD, name: "" }, ip(2)))).status).toBe(400);
    expect((await leadsPOST(pub(GOOD, ip(2), "https://evil.test"))).status).toBe(403);
    expect((await leadsPOST(pub(GOOD, ip(2), null))).status).toBe(403);
    expect((await listLeads()).leads).toHaveLength(1);
  });

  it("silently drops submissions that fill the hidden field", async () => {
    const before = sent.length;
    expect((await leadsPOST(pub({ ...GOOD, website: "http://spam.test" }, ip(3)))).status).toBe(201);
    expect((await listLeads()).leads).toHaveLength(1);
    expect(sent).toHaveLength(before);
  });

  it("limits requests per address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await leadsPOST(pub({ ...GOOD, company: `Co ${i}` }, ip(77)))).status);
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});

describe("lead status is for platform admins only", () => {
  it("anonymous and organization admins cannot change it; a super admin can", async () => {
    const id = (await listLeads()).leads.at(-1)!.id;
    expect((await leadPATCH(...patch(id, null, { status: "contacted" }))).status).toBe(401);
    expect((await leadPATCH(...patch(id, "bob", { status: "contacted" }))).status).toBe(403);
    expect((await leadPATCH(...patch(id, "root", { status: "bogus" }))).status).toBe(400);
    expect((await leadPATCH(...patch("not-a-uuid", "root", { status: "closed" }))).status).toBe(404);
    expect((await leadPATCH(...patch(id, "root", { status: "contacted" }))).status).toBe(200);
    expect((await listLeads()).leads.find((l) => l.id === id)!.status).toBe("contacted");
  });
});
