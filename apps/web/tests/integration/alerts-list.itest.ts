import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as alertsGET } from "@/app/api/alerts/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.1.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = async (qs: string, who = "a") => {
  const res = await alertsGET(new Request(`${BASE}/api/alerts?${qs}`, { headers: { cookie: cookies[who]! } }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  const va = (await db.insert(schema.vehicles).values({ organizationId: a!.id, name: "Truck 7" }).returning())[0]!;
  const v100 = (await db.insert(schema.vehicles).values({ organizationId: a!.id, name: "100% Diesel" }).returning())[0]!;
  // Org A: 30 speeding (Sep 20, UTC noon + i minutes), 5 geofence (Sep 22), 3 acknowledged offline (Sep 24)
  const rows: (typeof schema.alertEvents.$inferInsert)[] = [];
  for (let i = 0; i < 30; i++) rows.push({ organizationId: a!.id, ruleName: "Highway limit", type: "speeding", vehicleId: va.id, occurredAt: new Date(Date.UTC(2026, 8, 20, 12, i)), details: { speedKph: 120, limitKph: 100 } });
  for (let i = 0; i < 5; i++) rows.push({ organizationId: a!.id, ruleName: "Depot", type: "geofence_exit", vehicleId: v100.id, occurredAt: new Date(Date.UTC(2026, 8, 22, 8, i)), details: { geofence: "Depot" } });
  for (let i = 0; i < 3; i++) rows.push({ organizationId: a!.id, ruleName: "Offline 90", type: "device_offline", vehicleId: va.id, occurredAt: new Date(Date.UTC(2026, 8, 24, 3, i)), acknowledgedAt: new Date(), details: { offlineMinutes: 90 } });
  rows.push({ organizationId: b!.id, ruleName: "Org B secret rule", type: "speeding", occurredAt: new Date(Date.UTC(2026, 8, 21)) });
  await db.insert(schema.alertEvents).values(rows);
  await createUserWithMembership({ email: "a@a.test", name: "A", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "b@b.test", name: "B", password: PASSWORD, organizationSlug: "org-b", role: "VIEWER" });
  cookies.a = await signIn("a@a.test");
  cookies.b = await signIn("b@b.test");
});
afterAll(async () => {
  await closeDb();
});

describe("paged alert list", () => {
  it("pages newest first, with totals and counts, only the caller's org", async () => {
    const { body } = await get("page=1&pageSize=10");
    expect(body.total).toBe(38);
    expect(body.counts).toEqual({ all: 38, unack: 35 });
    expect(body.items).toHaveLength(10);
    expect(body.items[0].type).toBe("device_offline");
    expect(JSON.stringify(body)).not.toContain("Org B secret rule");
    const last = await get("page=4&pageSize=10");
    expect(last.body.items).toHaveLength(8);
    const other = await get("page=1", "b");
    expect(other.body.total).toBe(1);
  });

  it("filters by status, type and search (wildcards escaped)", async () => {
    expect((await get("status=unack")).body.total).toBe(35);
    expect((await get("status=ack")).body.total).toBe(3);
    expect((await get("type=geofence_exit")).body.total).toBe(5);
    expect((await get("search=highway")).body.total).toBe(30);
    expect((await get("search=100%25")).body.total).toBe(5); // vehicle "100% Diesel"
    expect((await get("search=%25")).body.total).toBe(5); // a bare % is literal, not "match all"
    expect((await get("search=Org%20B")).body.total).toBe(0);
  });

  it("filters by local calendar day in the viewer's time zone", async () => {
    // Sep 20 12:00–12:29 UTC is Sep 20 in Chicago (UTC-5)
    expect((await get("from=2026-09-20&to=2026-09-20&tz=America/Chicago")).body.total).toBe(30);
    // Sep 24 03:00 UTC is still Sep 23 in Chicago
    expect((await get("from=2026-09-23&to=2026-09-23&tz=America/Chicago")).body.total).toBe(3);
    expect((await get("from=2026-09-24&to=2026-09-24&tz=America/Chicago")).body.total).toBe(0);
    expect((await get("from=2026-09-24&to=2026-09-24&tz=UTC")).body.total).toBe(3);
  });

  it("ignores invalid parameters instead of failing, and the legacy form still works", async () => {
    const bad = await get("page=1&pageSize=9999&type=nope&tz=Mars/Base&from=yesterday");
    expect(bad.status).toBe(200);
    expect(bad.body.pageSize).toBe(25);
    expect(bad.body.total).toBe(38);
    const legacy = await get("limit=1&unacknowledged=1");
    expect(legacy.body.events).toHaveLength(1);
    expect(legacy.body.unacknowledged).toBe(35);
  });
});
