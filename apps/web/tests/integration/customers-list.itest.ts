import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { getCustomerDetail } from "@/lib/customers";
import { GET as customersGET } from "@/app/api/admin/customers/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA = "";
async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.3.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = (qs: string, who: string) => customersGET(new Request(`${BASE}/api/admin/customers?${qs}`, { headers: { cookie: cookies[who]! } }));

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const orgs = await db
    .insert(schema.organizations)
    .values([{ name: "Platform", slug: "platform" }, ...Array.from({ length: 12 }, (_, i) => ({ name: `Carrier ${String(i + 1).padStart(2, "0")}`, slug: `carrier-${i + 1}` }))])
    .returning();
  orgA = orgs[1]!.id;
  const p = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: p.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880" });
  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, organizationSlug: "platform", role: "ORG_ADMIN", superAdmin: true });
  await createUserWithMembership({ email: "admin@c1.test", name: "C1 Admin", password: PASSWORD, organizationSlug: "carrier-1", role: "ORG_ADMIN" });
  cookies.root = await signIn("root@platform.test");
  cookies.admin = await signIn("admin@c1.test");
});
afterAll(async () => {
  await closeDb();
});

describe("platform customer list", () => {
  it("org admins get 403 on the paged form too", async () => {
    expect((await get("page=1", "admin")).status).toBe(403);
  });

  it("pages, searches and sorts for the super admin", async () => {
    const b = await (await get("page=1&pageSize=10", "root")).json();
    expect(b.total).toBe(13);
    expect(b.items).toHaveLength(10);
    expect((await (await get("search=carrier%200", "root")).json()).total).toBe(9); // Carrier 01..09
    const byDevices = await (await get("sort=devices&direction=desc", "root")).json();
    expect(byDevices.items[0]).toMatchObject({ name: "Carrier 01", devices: 1 });
  });

  it("detail exposes only the IMEI's last 4 digits", async () => {
    const d = await getCustomerDetail(orgA);
    expect(d?.devices[0]?.imeiLast4).toBe("6115");
    expect(JSON.stringify(d)).not.toContain(IMEI);
  });
});
