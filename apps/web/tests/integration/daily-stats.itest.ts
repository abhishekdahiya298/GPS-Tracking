import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildActivityReport } from "@/lib/activity-reports";
import { getFleetCharts, refreshDailyStats } from "@/lib/daily-stats";
import { ingestPosition } from "@/lib/ingest";

const IMEI_A = "864361078566115";
const IMEI_B = "350000000000088";
let orgA: string, orgB: string, devA: string;
// "Now" for the tests: Sep 25, 2026, 6 PM in Toronto.
const NOW = new Date("2026-09-25T22:00:00Z");
const DAY0 = Date.parse("2026-09-24T12:00:00Z"); // Sep 24, 8:00 AM Toronto

const point = (imei: string, t: number, km: number, speedKph: number, ignition: boolean) =>
  ingestPosition({ externalDeviceId: imei, imei, latitude: 43.6 + km * 0.009, longitude: -79.7, speedKph, headingDeg: 0, altitudeM: 0, recordedAt: new Date(t), valid: true, ignition, motion: speedKph > 0 }, { now: new Date(NOW.getTime() - 3_600_000) });

/** A drive of `minutes` at 60 km/h (1 km per minute) starting at `t0`, then ignition off. */
async function drive(imei: string, t0: number, minutes: number, fromKm = 0) {
  for (let i = 0; i <= minutes; i++) await point(imei, t0 + i * 60_000, fromKm + i, i === minutes ? 0 : 60, true);
  await point(imei, t0 + (minutes + 1) * 60_000, fromKm + minutes, 0, false);
}
const rows = async (org: string) => getDb().select().from(schema.deviceDailyStats).where(eq(schema.deviceDailyStats.organizationId, org)).orderBy(schema.deviceDailyStats.day);

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate daily_stats_state, audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b", timeZone: "America/Vancouver" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI_A, imei: IMEI_A, model: "FTM880" }).returning())[0]!.id;
  await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb.id, externalDeviceId: IMEI_B, imei: IMEI_B, name: "B truck" });
  // Org A: 10 km on Sep 24 morning, and a 20-minute drive across Toronto midnight (Sep 24 → 25).
  await drive(IMEI_A, DAY0, 10);
  await drive(IMEI_A, Date.parse("2026-09-25T03:50:00Z"), 20, 20);
  // Org B (Vancouver): 5 km on Sep 24.
  await drive(IMEI_B, DAY0 + 6 * 3_600_000, 5);
});
afterAll(async () => {
  await closeDb();
});

describe("daily stats", () => {
  it("first pass backfills each device's local days; a trip across midnight is split", async () => {
    const r = await refreshDailyStats(NOW);
    expect(r).toMatchObject({ failed: 0, rebuiltOrganizations: 2 });
    const a = await rows(orgA);
    expect(a.map((x) => x.day)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(a[0]).toMatchObject({ timeZone: "America/Toronto", trips: 2, maxSpeedKph: 60 });
    expect(a[0]!.distanceM).toBeGreaterThan(19_800); // 10 km + the 10 km before midnight
    expect(a[0]!.distanceM).toBeLessThan(20_300);
    expect(a[1]!.distanceM).toBeGreaterThan(9_800); // the 10 km after midnight
    expect(a[1]!.trips).toBe(0); // counted on the day it started
    const b = await rows(orgB);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ timeZone: "America/Vancouver", day: "2026-09-24" });
  });

  it("agrees with the mileage report for the same days", async () => {
    const report = await buildActivityReport(orgA, { type: "mileage", deviceId: "all", from: "2026-09-24T04:00:00Z", to: "2026-09-26T04:00:00Z", minMinutes: 5, limitKph: 110, format: "json" }, "America/Toronto", NOW);
    const stats = await rows(orgA);
    expect(Math.abs(report.totals.distanceKm - stats.reduce((s, x) => s + x.distanceM, 0) / 1000)).toBeLessThan(0.2);
  });

  it("is idempotent, and a late-arriving point for an earlier day is picked up", async () => {
    const before = await rows(orgA);
    await refreshDailyStats(NOW);
    expect((await rows(orgA)).map((x) => [x.day, x.distanceM])).toEqual(before.map((x) => [x.day, x.distanceM]));
    // The tracker delivers a buffered afternoon drive for Sep 24 a day late.
    await drive(IMEI_A, DAY0 + 4 * 3_600_000, 5, 12);
    const r = await refreshDailyStats(NOW);
    expect(r.recomputed).toBeGreaterThan(0);
    const after = await rows(orgA);
    expect(after[0]!.trips).toBe(3);
    expect(after[0]!.distanceM).toBeGreaterThan(before[0]!.distanceM + 4_800);
  });

  it("the watermark advances only over rows older than two minutes, then quiet passes do nothing", async () => {
    const later = new Date(NOW.getTime() + 3_600_000);
    const first = await refreshDailyStats(later);
    expect(first.watermark).toBeGreaterThan(0);
    const quiet = await refreshDailyStats(later);
    expect(quiet).toMatchObject({ recomputed: 0, rebuiltOrganizations: 0, watermark: first.watermark });
  });

  it("changing an organization's time zone rebuilds only that organization's days", async () => {
    await getDb().update(schema.organizations).set({ timeZone: "UTC" }).where(eq(schema.organizations.id, orgA));
    const r = await refreshDailyStats(new Date(NOW.getTime() + 3_600_000));
    expect(r.rebuiltOrganizations).toBe(1);
    const a = await rows(orgA);
    expect(new Set(a.map((x) => x.timeZone))).toEqual(new Set(["UTC"]));
    // In UTC the midnight drive (03:50–04:10Z on Sep 25) is entirely on Sep 25.
    expect(a.find((x) => x.day === "2026-09-25")!.distanceM).toBeGreaterThan(19_800);
    expect((await rows(orgB))[0]!.timeZone).toBe("America/Vancouver");
    await getDb().update(schema.organizations).set({ timeZone: "America/Toronto" }).where(eq(schema.organizations.id, orgA));
    await refreshDailyStats(new Date(NOW.getTime() + 3_600_000));
  });

  it("dashboard charts: 30 zero-filled days, idling ratio, tenant-scoped", async () => {
    const a = await getFleetCharts(orgA, "America/Toronto", NOW);
    expect(a.mileage).toHaveLength(30);
    expect(a.mileage.at(-1)!.day).toBe("2026-09-25");
    expect(a.mileage[0]!.day).toBe("2026-08-27");
    expect(a.mileage.at(-2)!.distanceKm).toBeGreaterThan(24); // Sep 24: 10 + 10 + 5 km
    expect(a.mileage.slice(0, 28).every((d) => d.distanceKm === 0)).toBe(true);
    expect(a.idling.drivingMin).toBeGreaterThan(30);
    expect(a.idling.ratio).not.toBeNull();
    expect(a.updatedAt).not.toBeNull();
    const total = a.mileage.reduce((s, d) => s + d.distanceKm, 0);
    const b = await getFleetCharts(orgB, "America/Vancouver", NOW);
    expect(b.mileage.reduce((s, d) => s + d.distanceKm, 0)).toBeGreaterThan(4.8);
    expect(b.mileage.reduce((s, d) => s + d.distanceKm, 0)).toBeLessThan(total); // never includes Org A
    expect(b.mileage.reduce((s, d) => s + d.distanceKm, 0)).toBeLessThan(5.3);
  });

  it("top speeding vehicles come from speeding alerts of the last 7 days, own organization only", async () => {
    const db = getDb();
    const v = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Truck 7" }).returning())[0]!;
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    await db.insert(schema.alertEvents).values([
      { organizationId: orgA, ruleName: "Hwy", type: "speeding", deviceId: devA, vehicleId: v.id, occurredAt: at(2), details: { speedKph: 131, limitKph: 110 } },
      { organizationId: orgA, ruleName: "Hwy", type: "speeding", deviceId: devA, vehicleId: v.id, occurredAt: at(30), details: { speedKph: 118, limitKph: 110 } },
      { organizationId: orgA, ruleName: "Hwy", type: "speeding", deviceId: devA, vehicleId: v.id, occurredAt: at(24 * 9), details: { speedKph: 150, limitKph: 110 } }, // too old
      { organizationId: orgA, ruleName: "Ign", type: "ignition_on", deviceId: devA, vehicleId: v.id, occurredAt: at(1), details: null },
      { organizationId: orgB, ruleName: "Hwy", type: "speeding", occurredAt: at(1), details: { speedKph: 160 } }
    ]);
    expect((await getFleetCharts(orgA, "America/Toronto", NOW)).speeding).toEqual([{ vehicle: "Truck 7", events: 2, maxSpeedKph: 131 }]);
    const b = (await getFleetCharts(orgB, "America/Vancouver", NOW)).speeding;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ events: 1, maxSpeedKph: 160 });
  });
});
