import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as tripsGET } from "@/app/api/reports/trips/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
let devA: string, devB: string, cookieA: string, cookieB: string;
const DAY0 = Date.parse("2026-09-24T12:00:00Z");

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = (qs: Record<string, string>, cookie: string) => tripsGET(new Request(`${BASE}/api/reports/trips?${new URLSearchParams(qs)}`, { headers: { cookie } }));

/** Two drives on the same day: 10 min / ~5 km, a 30-min stop, then 6 min / ~3 km. */
async function seedDrives() {
  const at = (m: number) => new Date(DAY0 + m * 60_000);
  const drive = async (startMin: number, minutes: number, kmPerMin: number, speed: number) => {
    for (let i = 0; i <= minutes; i++) {
      await ingestPosition({ externalDeviceId: IMEI, imei: IMEI, latitude: 43.6 + (startMin + i) * kmPerMin * 0.009, longitude: -79.7, speedKph: i === minutes ? 0 : speed, headingDeg: 0, altitudeM: 0, recordedAt: at(startMin + i), valid: true, ignition: true, motion: true });
    }
    await ingestPosition({ externalDeviceId: IMEI, imei: IMEI, latitude: 43.6 + (startMin + minutes) * kmPerMin * 0.009, longitude: -79.7, speedKph: 0, headingDeg: 0, altitudeM: 0, recordedAt: at(startMin + minutes + 1), valid: true, ignition: false, motion: false });
  };
  await drive(0, 10, 0.5, 30);
  await drive(41, 6, 0.5, 30);
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: a!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: b!.id, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: a!.id, providerId: pa.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: b!.id, providerId: pb.id, externalDeviceId: "350000000000088", imei: "350000000000088" }).returning())[0]!.id;
  const v = (await db.insert(schema.vehicles).values({ organizationId: a!.id, name: "=cmd|' /C calc'!A0" }).returning())[0]!;
  await db.insert(schema.deviceAssignments).values({ organizationId: a!.id, deviceId: devA, vehicleId: v.id });
  await createUserWithMembership({ email: "viewer@a.test", name: "v", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "admin@b.test", name: "b", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookieA = await signIn("viewer@a.test", "198.51.100.200");
  cookieB = await signIn("admin@b.test", "198.51.100.201");
  await seedDrives();
});
afterAll(async () => {
  await closeDb();
});

const window = { from: "2026-09-24T00:00:00Z", to: "2026-09-25T00:00:00Z" };

describe("trip reports", () => {
  it("detects the two drives with distance, durations and daily totals", async () => {
    const res = await get({ deviceId: devA, ...window, tz: "America/Toronto" }, cookieA);
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.trips).toHaveLength(2);
    expect(r.trips[0].durationMin).toBe(10);
    expect(r.trips[0].distanceKm).toBeGreaterThan(4.8);
    expect(r.trips[0].distanceKm).toBeLessThan(5.2);
    expect(r.trips[0].maxSpeedKph).toBe(30);
    expect(r.trips[1].durationMin).toBe(6);
    expect(r.totals.trips).toBe(2);
    expect(r.days).toEqual([expect.objectContaining({ day: "2026-09-24", trips: 2 })]);
  });

  it("CSV export: attachment, header, formula-injection-safe vehicle name", async () => {
    const res = await get({ deviceId: devA, ...window, tz: "UTC", format: "csv" }, cookieA);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="trips-[A-Za-z0-9_-]+-2026-09-24-to-2026-09-25\.csv"$/);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("vehicle,start_local,end_local,duration_min,driving_min,idle_min,distance_km,max_speed_kph,avg_moving_kph,start_lat,start_lon,end_lat,end_lon");
    expect(lines).toHaveLength(3);
    expect(lines[1]!.startsWith(`"'=cmd|' /C calc'!A0"`) || lines[1]!.startsWith(`'=cmd`)).toBe(true);
  });

  it("another org's device is a 404; validation errors are 400", async () => {
    expect((await get({ deviceId: devA, ...window }, cookieB)).status).toBe(404);
    expect((await get({ deviceId: devB, ...window }, cookieA)).status).toBe(404);
    expect((await get({ deviceId: devA, from: "2026-01-01T00:00:00Z", to: "2026-09-25T00:00:00Z" }, cookieA)).status).toBe(400);
    expect((await get({ deviceId: devA, ...window, tz: "Mars/Olympus" }, cookieA)).status).toBe(400);
    expect((await get({ deviceId: devA, from: window.to, to: window.from }, cookieA)).status).toBe(400);
  });

  it("401 without a session", async () => {
    expect((await tripsGET(new Request(`${BASE}/api/reports/trips?deviceId=${devA}&from=${window.from}&to=${window.to}`))).status).toBe(401);
  });
});
