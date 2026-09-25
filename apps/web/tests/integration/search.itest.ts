import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as searchGET } from "@/app/api/search/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
let ipN = 1;
async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.4.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const search = async (q: string, who: string) => {
  const res = await searchGET(new Request(`${BASE}/api/search?${new URLSearchParams({ q })}`, { headers: { cookie: cookies[who]! } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { hits: { group: string; title: string; subtitle: string | null; href: string }[] }).hits;
};

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a, b] = await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B Hauling", slug: "org-b" }]).returning();
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: a!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  await db.insert(schema.gpsDevices).values({ organizationId: a!.id, providerId: pa.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880", name: "Reefer tracker" });
  for (let i = 1; i <= 8; i++) await db.insert(schema.vehicles).values({ organizationId: a!.id, name: `Reefer ${i}`, licensePlate: `TX-${i}00` });
  await db.insert(schema.vehicles).values({ organizationId: b!.id, name: "Reefer secret B" });
  await db.insert(schema.geofences).values({ organizationId: a!.id, name: "Reefer yard", kind: "circle", centerLat: 30, centerLon: -97, radiusM: 200 });
  await createUserWithMembership({ email: "admin@a.test", name: "Alice", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "viewer@a.test", name: "Victor", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "root@a.test", name: "Root", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER", superAdmin: true });
  cookies.admin = await signIn("admin@a.test");
  cookies.viewer = await signIn("viewer@a.test");
  cookies.root = await signIn("root@a.test");
});
afterAll(async () => {
  await closeDb();
});

describe("global search", () => {
  it("returns ≤ 5 per group, only from the caller's organization", async () => {
    const hits = await search("reefer", "admin");
    const vehicles = hits.filter((h) => h.group === "vehicles");
    expect(vehicles).toHaveLength(5);
    expect(JSON.stringify(hits)).not.toContain("secret B");
    expect(hits.some((h) => h.group === "devices" && h.title === "Reefer tracker")).toBe(true);
    expect(hits.some((h) => h.group === "zones")).toBe(true);
    expect(hits.some((h) => h.group === "customers")).toBe(false);
  });

  it("gates groups by permission: viewers can't search the team; only admins match IMEI digits", async () => {
    expect((await search("alice", "viewer")).some((h) => h.group === "team")).toBe(false);
    expect((await search("alice", "admin")).some((h) => h.group === "team")).toBe(true);
    expect((await search("6115", "viewer")).filter((h) => h.group === "devices")).toHaveLength(0);
    const admin = await search("6115", "admin");
    expect(admin.filter((h) => h.group === "devices")).toHaveLength(1);
    expect(JSON.stringify(admin)).not.toContain(IMEI); // the IMEI itself is never returned
  });

  it("customers only for platform admins; short or wildcard queries return nothing", async () => {
    expect((await search("hauling", "root")).some((h) => h.group === "customers" && h.title === "Org B Hauling")).toBe(true);
    expect(await search("r", "admin")).toEqual([]);
    expect(await search("%%", "admin")).toEqual([]);
  });
});
