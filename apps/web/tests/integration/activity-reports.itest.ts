import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as activityGET } from "@/app/api/reports/activity/route";
import { GET as tripsGET } from "@/app/api/reports/trips/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI_A = "864361078566115";
const IMEI_B = "350000000000088";
let devA: string, devB: string, cookieA: string, cookieB: string;
const DAY0 = Date.parse("2026-09-24T12:00:00Z"); // 8:00 AM in Toronto
const window = { from: "2026-09-24T04:00:00Z", to: "2026-09-25T04:00:00Z" }; // Sep 24, Toronto

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = (qs: Record<string, string>, cookie: string) => activityGET(new Request(`${BASE}/api/reports/activity?${new URLSearchParams({ ...window, ...qs })}`, { headers: { cookie } }));
const json = async (qs: Record<string, string>, cookie = cookieA) => {
  const res = await get(qs, cookie);
  expect(res.status).toBe(200);
  return res.json();
};

const point = (imei: string, m: number, km: number, speedKph: number, ignition: boolean) =>
  ingestPosition({ externalDeviceId: imei, imei, latitude: 43.6 + km * 0.009, longitude: -79.7, speedKph, headingDeg: 0, altitudeM: 0, recordedAt: new Date(DAY0 + m * 60_000), valid: true, ignition, motion: speedKph > 0 });

/**
 * Truck A on Sep 24 (minutes after 8:00 AM Toronto):
 *   0–10 drive at 30 km/h (5 km) · 11 ignition off · parked until 41
 *   41–49 engine on, standing (idling) · 50–55 drive at 130 km/h (3 km) · 56 stop · 57 ignition off
 */
async function seed() {
  for (let i = 0; i <= 10; i++) await point(IMEI_A, i, i * 0.5, i === 10 ? 0 : 30, true);
  await point(IMEI_A, 11, 5, 0, false);
  for (let i = 41; i <= 49; i++) await point(IMEI_A, i, 5, 0, true);
  for (let i = 50; i <= 56; i++) await point(IMEI_A, i, 5 + (i - 49) * 0.5, i === 56 ? 0 : 130, true);
  await point(IMEI_A, 57, 8.5, 0, false);
  // Another tenant's truck, speeding at the same time: must never appear for Org A.
  for (let i = 0; i <= 5; i++) await point(IMEI_B, i, i, 150, true);
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: a!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: b!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: a!.id, providerId: pa.id, externalDeviceId: IMEI_A, imei: IMEI_A, model: "FTM880" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: b!.id, providerId: pb.id, externalDeviceId: IMEI_B, imei: IMEI_B, name: "Secret B truck" }).returning())[0]!.id;
  const v = (await db.insert(schema.vehicles).values({ organizationId: a!.id, name: "=SUM(A1) Truck" }).returning())[0]!;
  await db.insert(schema.deviceAssignments).values({ organizationId: a!.id, deviceId: devA, vehicleId: v.id });
  await createUserWithMembership({ email: "viewer@a.test", name: "v", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "admin@b.test", name: "b", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookieA = await signIn("viewer@a.test", "198.51.100.210");
  cookieB = await signIn("admin@b.test", "198.51.100.211");
  await seed();
});
afterAll(async () => {
  await closeDb();
});

describe("activity reports", () => {
  it("stops: the gap between trips, and an ongoing stop after the last trip", async () => {
    const r = await json({ type: "stops" });
    expect(r.rows).toHaveLength(2);
    const [last, first] = r.rows; // newest first
    expect(first).toMatchObject({ vehicle: "=SUM(A1) Truck", startAt: "2026-09-24T12:10:00.000Z", endAt: "2026-09-24T12:41:00.000Z", durationMin: 31 });
    expect(last).toMatchObject({ startAt: "2026-09-24T12:56:00.000Z", endAt: null });
    expect(r.totals.count).toBe(2);
    expect((await json({ type: "stops", minMinutes: "60" })).rows).toHaveLength(1); // only the ongoing one
  });

  it("idling: engine on while standing", async () => {
    const r = await json({ type: "idling" });
    expect(r.rows).toEqual([expect.objectContaining({ startAt: "2026-09-24T12:41:00.000Z", endAt: "2026-09-24T12:50:00.000Z", durationMin: 9 })]);
    expect((await json({ type: "idling", minMinutes: "10" })).rows).toEqual([]);
  });

  it("speeding: against the limit given, independent of alert rules", async () => {
    const r = await json({ type: "speeding", limitKph: "110" });
    expect(r.rows).toEqual([expect.objectContaining({ startAt: "2026-09-24T12:50:00.000Z", endAt: "2026-09-24T12:55:00.000Z", durationS: 300, maxSpeedKph: 130, overKph: 20 })]);
    expect(r.totals.maxSpeedKph).toBe(130);
    expect((await json({ type: "speeding", limitKph: "130" })).rows).toEqual([]);
  });

  it("mileage: per local day and month, equal to the trip report's distance", async () => {
    const r = await json({ type: "mileage" });
    expect(r.rows).toEqual([expect.objectContaining({ day: "2026-09-24", trips: 2 })]);
    expect(r.months).toEqual([expect.objectContaining({ month: "2026-09", trips: 2 })]);
    const trips = await (await tripsGET(new Request(`${BASE}/api/reports/trips?${new URLSearchParams({ deviceId: devA, ...window })}`, { headers: { cookie: cookieA } }))).json();
    expect(Math.abs(r.totals.distanceKm - trips.totals.distanceKm)).toBeLessThanOrEqual(0.1);
    expect(r.totals.distanceKm).toBeGreaterThan(8);
    expect(r.timeZone).toBe("America/Toronto"); // organization default
  });

  it("tenant isolation: never another organization's vehicles or devices", async () => {
    for (const type of ["stops", "idling", "speeding", "mileage"]) {
      const mine = await json({ type, limitKph: "100" });
      expect(JSON.stringify(mine)).not.toContain("Secret B");
      expect(JSON.stringify(mine)).not.toContain(devB);
    }
    expect((await get({ type: "speeding", deviceId: devB }, cookieA)).status).toBe(404);
    expect((await get({ type: "speeding", deviceId: devA }, cookieB)).status).toBe(404);
    const theirs = await json({ type: "speeding", limitKph: "100" }, cookieB);
    expect(theirs.rows).toHaveLength(1);
    expect(theirs.rows[0].vehicle).toBe("Secret B truck");
  });

  it("one vehicle or all give the same rows here", async () => {
    const one = await json({ type: "stops", deviceId: devA });
    const all = await json({ type: "stops" });
    expect(one.rows).toEqual(all.rows);
  });

  it("CSV: attachment, organization units, formula-injection-safe names", async () => {
    const res = await get({ type: "speeding", limitKph: "110", format: "csv" }, cookieA);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="speeding-2026-09-24-to-2026-09-25.csv"');
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("vehicle,start_local,end_local,duration_s,max_speed_mph,limit_mph,lat,lon,time_zone");
    expect(lines[1]).toMatch(/^'=SUM\(A1\) Truck,2026-09-24 08:50,2026-09-24 08:55,300,81,68,/); // 130 km/h = 81 mph
    expect(lines[1]!.endsWith(",EDT")).toBe(true);
    const stops = (await (await get({ type: "stops", format: "csv" }, cookieA)).text()).trim().split("\r\n");
    expect(stops[1]).toContain(",ongoing,");
    const mileage = (await (await get({ type: "mileage", format: "csv" }, cookieA)).text()).trim().split("\r\n");
    expect(mileage[0]).toBe("vehicle,day,distance_mi,driving_min,idle_min,trips");
  });

  it("validation and auth", async () => {
    expect((await get({ type: "fuel" }, cookieA)).status).toBe(400);
    expect((await get({ type: "stops", from: "2026-01-01T00:00:00Z" }, cookieA)).status).toBe(400); // > 31 days
    expect((await get({ type: "stops", from: window.to, to: window.from }, cookieA)).status).toBe(400);
    expect((await get({ type: "stops", tz: "Mars/Olympus" }, cookieA)).status).toBe(400);
    expect((await get({ type: "stops", deviceId: "not-a-uuid" }, cookieA)).status).toBe(400);
    expect((await get({ type: "speeding", limitKph: "5" }, cookieA)).status).toBe(400);
    expect((await activityGET(new Request(`${BASE}/api/reports/activity?type=stops&from=${window.from}&to=${window.to}`))).status).toBe(401);
  });
});
