import "./setup-env";
import { createHash } from "node:crypto";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { POST as viewPOST } from "@/app/api/share/view/route";
import { GET as linksGET, POST as linksPOST } from "@/app/api/share-links/route";
import { DELETE as linkDELETE } from "@/app/api/share-links/[id]/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI_A = "864361078566115";
const IMEI_A2 = "350000000000096";
const IMEI_B = "350000000000088";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA: string, vA: string, vA2: string, vB: string, devA: string;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.9.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown, origin = BASE) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
const create = (who: string, body: Record<string, unknown>, origin = BASE) => linksPOST(req("POST", "/api/share-links", who, body, origin));
/** The public endpoint: no cookie at all. Each call may use its own client address. */
const view = (token: unknown, ip = "203.0.113.5", origin: string | null = BASE) =>
  viewPOST(
    new Request(`${BASE}/api/share/view`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}) },
      body: JSON.stringify({ token })
    })
  );
const fix = (imei: string, lat: number, speedKph: number, at: string) =>
  ingestPosition({ externalDeviceId: imei, imei, latitude: lat, longitude: -79.7, speedKph, headingDeg: 90, altitudeM: 0, recordedAt: new Date(at), valid: true, ignition: true, motion: speedKph > 0 });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a, b] = await db.insert(schema.organizations).values([{ name: "Secret Org A Inc", slug: "org-a", timeZone: "America/Toronto" }, { name: "Org B", slug: "org-b" }]).returning();
  orgA = a!.id;
  const va = await db.insert(schema.vehicles).values([{ organizationId: orgA, name: "Truck 7", licensePlate: "PLATE-777" }, { organizationId: orgA, name: "Truck 8" }]).returning();
  [vA, vA2] = va.map((v) => v.id) as [string, string];
  vB = (await db.insert(schema.vehicles).values({ organizationId: b!.id, name: "B truck" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: b!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI_A, imei: IMEI_A, name: "Tracker one" }).returning())[0]!.id;
  const devA2 = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI_A2, imei: IMEI_A2 }).returning())[0]!.id;
  const devB = (await db.insert(schema.gpsDevices).values({ organizationId: b!.id, providerId: pb.id, externalDeviceId: IMEI_B, imei: IMEI_B }).returning())[0]!.id;
  await db.insert(schema.deviceAssignments).values([
    { organizationId: orgA, deviceId: devA, vehicleId: vA },
    { organizationId: orgA, deviceId: devA2, vehicleId: vA2 },
    { organizationId: b!.id, deviceId: devB, vehicleId: vB }
  ]);
  await fix(IMEI_A, 43.6, 72, "2026-10-05T15:00:00Z");
  await fix(IMEI_A2, 44.9, 10, "2026-10-05T15:00:00Z");
  await fix(IMEI_B, 49.2, 55, "2026-10-05T15:00:00Z");
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "DISPATCHER" | "VIEWER") => createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role });
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("dispatch@a.test", "org-a", "DISPATCHER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("admin@b.test", "org-b", "ORG_ADMIN");
  for (const [k, e] of [["fleet", "fleet@a.test"], ["dispatch", "dispatch@a.test"], ["viewer", "viewer@a.test"], ["bob", "admin@b.test"]] as const) cookies[k] = await signIn(e);
});
afterAll(async () => {
  await closeDb();
});

describe("share links", () => {
  let token: string;
  let linkId: string;

  it("only vehicle managers can create; never for another organization's vehicle", async () => {
    expect((await create("viewer", { vehicleId: vA })).status).toBe(403);
    expect((await create("dispatch", { vehicleId: vA })).status).toBe(403);
    expect((await create("fleet", { vehicleId: vA }, "https://evil.example")).status).toBe(403);
    expect((await create("fleet", { vehicleId: vB })).status).toBe(404);
    expect((await create("bob", { vehicleId: vA })).status).toBe(404);
    expect((await create("fleet", { vehicleId: vA, hours: 0 })).status).toBe(400);
    expect((await create("fleet", { vehicleId: vA, hours: 721 })).status).toBe(400);
    expect((await create("fleet", { vehicleId: "nope" })).status).toBe(400);
    expect((await linksPOST(new Request(`${BASE}/api/share-links`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ vehicleId: vA }) }))).status).toBe(401);
  });

  it("returns the token once; the database keeps only its hash; default is 24 hours", async () => {
    const before = Date.now();
    const res = await create("fleet", { vehicleId: vA, label: "Acme dock" });
    expect(res.status).toBe(201);
    const body = await res.json();
    token = body.token;
    linkId = body.id;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(body.expiresAt) - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.99);
    expect(hours).toBeLessThan(24.01);
    const [row] = await getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.id, linkId));
    expect(row!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "share_link.created"));
    expect(audit).toMatchObject({ organizationId: orgA, targetId: linkId });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("the owner's list never contains the token or its hash, and is tenant-scoped", async () => {
    const res = await linksGET(req("GET", "/api/share-links", "fleet"));
    const text = await res.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain(createHash("sha256").update(token).digest("hex"));
    expect(JSON.parse(text).links).toEqual([expect.objectContaining({ id: linkId, vehicleName: "Truck 7", label: "Acme dock", active: true, viewCount: 0, createdByName: "fleet" })]);
    expect((await (await linksGET(req("GET", "/api/share-links", "bob"))).json()).links).toEqual([]);
    expect((await linksGET(req("GET", "/api/share-links", "viewer"))).status).toBe(403);
  });

  it("the public view shows that one vehicle's position and nothing else", async () => {
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const text = await res.text();
    const body = JSON.parse(text);
    // Exactly these fields: adding one must be a deliberate decision (and a test change).
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "location", "timeFormat", "timeZone", "unitSystem", "vehicleName"]);
    expect(Object.keys(body.location).sort()).toEqual(["headingDeg", "ignition", "latitude", "longitude", "recordedAt", "speedKph"]);
    expect(body).toMatchObject({ vehicleName: "Truck 7", timeZone: "America/Toronto", location: { latitude: 43.6, speedKph: 72, recordedAt: "2026-10-05T15:00:00.000Z" } });
    for (const secret of ["Secret Org A", IMEI_A, devA, orgA, vA, "PLATE-777", "Tracker one", "Acme dock", "fleet@a.test", "Truck 8", linkId]) expect(text).not.toContain(secret);
  });

  it("follows the vehicle: new fixes appear, an unassigned tracker shows no position", async () => {
    await fix(IMEI_A, 43.7, 0, "2026-10-05T15:05:00Z");
    expect((await (await view(token)).json()).location).toMatchObject({ latitude: 43.7, speedKph: 0 });
    await getDb().update(schema.deviceAssignments).set({ unassignedAt: new Date() }).where(eq(schema.deviceAssignments.deviceId, devA));
    const body = await (await view(token)).json();
    expect(body.location).toBeNull(); // not the old tracker's position, and not another vehicle's
    expect(body.vehicleName).toBe("Truck 7");
    await getDb().update(schema.deviceAssignments).set({ unassignedAt: null }).where(eq(schema.deviceAssignments.deviceId, devA));
    // A deactivated tracker stops being shared too.
    await getDb().update(schema.gpsDevices).set({ status: "inactive" }).where(eq(schema.gpsDevices.id, devA));
    expect((await (await view(token)).json()).location).toBeNull();
    await getDb().update(schema.gpsDevices).set({ status: "active" }).where(eq(schema.gpsDevices.id, devA));
    const [row] = await getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.id, linkId));
    expect(row!.viewCount).toBeGreaterThanOrEqual(3);
  });

  it("unknown, malformed, expired and revoked tokens are indistinguishable", async () => {
    const other = (await (await create("fleet", { vehicleId: vA2, hours: 1 })).json()) as { id: string; token: string };
    const expired = (await (await create("fleet", { vehicleId: vA2, hours: 1 })).json()) as { id: string; token: string };
    await getDb().update(schema.shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.shareLinks.id, expired.id));
    expect((await linkDELETE(req("DELETE", `/api/share-links/${other.id}`, "fleet"), { params: Promise.resolve({ id: other.id }) })).status).toBe(200);

    const answers = [];
    for (const t of [other.token, expired.token, "A".repeat(43), "short", "", null, 42, `${token}x`, "'; drop table share_links;--"]) {
      const res = await view(t);
      answers.push(`${res.status} ${await res.text()}`);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe('404 {"error":{"code":"NOT_AVAILABLE","message":"This link is not available."}}');
    expect((await view(token)).status).toBe(200); // the good link is unaffected
  });

  it("revoking is tenant-scoped, immediate and idempotent", async () => {
    const del = (who: string, id: string) => linkDELETE(req("DELETE", `/api/share-links/${id}`, who), { params: Promise.resolve({ id }) });
    expect((await del("bob", linkId)).status).toBe(404);
    expect((await del("viewer", linkId)).status).toBe(403);
    expect((await del("dispatch", linkId)).status).toBe(403);
    expect((await view(token)).status).toBe(200);
    expect((await del("fleet", linkId)).status).toBe(200);
    expect((await view(token)).status).toBe(404);
    expect((await del("fleet", linkId)).status).toBe(200);
    expect((await del("fleet", "not-a-uuid")).status).toBe(404);
    expect(await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "share_link.revoked"))).toHaveLength(2);
    const list = (await (await linksGET(req("GET", "/api/share-links", "fleet"))).json()).links as { id: string; active: boolean }[];
    expect(list.find((l) => l.id === linkId)!.active).toBe(false);
  });

  it("deleting the vehicle removes its links", async () => {
    const t = ((await (await create("fleet", { vehicleId: vA2 })).json()) as { token: string }).token;
    expect((await view(t)).status).toBe(200);
    await getDb().delete(schema.vehicles).where(eq(schema.vehicles.id, vA2));
    expect((await view(t)).status).toBe(404);
  });

  it("the public endpoint rejects cross-origin posts and is rate-limited per address", async () => {
    const t = ((await (await create("fleet", { vehicleId: vA })).json()) as { token: string }).token;
    expect((await view(t, "203.0.113.50", "https://evil.example")).status).toBe(403);
    expect((await view(t, "203.0.113.50", null)).status).toBe(403);
    const ip = `203.0.113.${100 + (Date.now() % 100)}`;
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const s = (await view(t, ip)).status;
      if (s === 200) ok++;
      else if (s === 429) limited++;
    }
    expect(ok).toBeLessThanOrEqual(120);
    expect(ok).toBeGreaterThanOrEqual(115); // a minute boundary may fall inside the loop
    expect(limited).toBeGreaterThanOrEqual(1);
    expect((await view(t, "203.0.113.7")).status).toBe(200); // other addresses are unaffected
  });

  it("limits active links per vehicle", async () => {
    const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from share_links where vehicle_id = ${vA} and revoked_at is null and expires_at > now()`)) as unknown as [{ n: number }];
    for (let i = n; i < 20; i++) expect((await create("fleet", { vehicleId: vA, hours: 1 })).status).toBe(201);
    expect((await create("fleet", { vehicleId: vA, hours: 1 })).status).toBe(400);
  });
});
