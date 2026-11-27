import "./setup-env";
import { locationChannel, type NormalizedPosition } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { ingestPosition } from "@/lib/ingest";
import { GET as currentGET } from "@/app/api/locations/current/route";
import { GET as historyGET } from "@/app/api/locations/history/route";
import { trackStats } from "@/app/(app)/map/fleet-model";
import { POST as webhookPOST } from "@/app/api/webhooks/traccar/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI_A = "864361078566115";
const IMEI_B = "350000000000001";
let orgA: string, orgB: string, devA: string, devB: string, vehicleA: string;
let cookieA: string, cookieB: string;
let subscriber: Redis;

const pos = (over: Partial<NormalizedPosition> = {}): NormalizedPosition => ({
  externalDeviceId: IMEI_A,
  imei: IMEI_A,
  latitude: 34.0522,
  longitude: -118.2437,
  speedKph: 42,
  headingDeg: 90,
  altitudeM: 80,
  recordedAt: new Date("2026-09-24T10:00:00Z"),
  valid: true,
  ignition: true,
  motion: true,
  ...over
});

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const get = (path: string, cookie?: string) => new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  const [pa] = await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning();
  const [pb] = await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning();
  const [da] = await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa!.id, externalDeviceId: IMEI_A, imei: IMEI_A, model: "FTM880" }).returning();
  const [dbb] = await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb!.id, externalDeviceId: IMEI_B, imei: IMEI_B, model: "FMM230" }).returning();
  devA = da!.id;
  devB = dbb!.id;
  const [v] = await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Range Rover", licensePlate: "RIO-1" }).returning();
  vehicleA = v!.id;
  await db.insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: devA, vehicleId: vehicleA });
  await createUserWithMembership({ email: "viewer@a.test", name: "va", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "admin@b.test", name: "ab", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  cookieA = await signIn("viewer@a.test", "192.0.2.101");
  cookieB = await signIn("admin@b.test", "192.0.2.102");
  subscriber = new Redis(process.env.TEST_REDIS_URL!);
});

afterAll(async () => {
  subscriber?.disconnect();
  await closeDb();
});

describe("ingest", () => {
  it("stores history + current in one step, attributing the active vehicle", async () => {
    const out = await ingestPosition(pos());
    expect(out).toMatchObject({ status: "stored", currentUpdated: true, organizationId: orgA, deviceId: devA });
    const [h] = await getDb().select().from(schema.locationHistory).where(eq(schema.locationHistory.deviceId, devA));
    expect(h).toMatchObject({ organizationId: orgA, vehicleId: vehicleA, latitude: 34.0522, ignition: true });
    const [dev] = await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, devA));
    expect(dev!.lastSeenAt).not.toBeNull();
  });

  it("redelivery of the same record is a no-op", async () => {
    expect((await ingestPosition(pos())).status).toBe("duplicate");
    const rows = await getDb().select().from(schema.locationHistory).where(eq(schema.locationHistory.deviceId, devA));
    expect(rows).toHaveLength(1);
  });

  it("late backlog goes to history but never replaces the current location", async () => {
    await ingestPosition(pos({ recordedAt: new Date("2026-09-24T10:05:00Z"), latitude: 34.1 }));
    const late = await ingestPosition(pos({ recordedAt: new Date("2026-09-24T09:30:00Z"), latitude: 33.9 }));
    expect(late).toMatchObject({ status: "stored", currentUpdated: false });
    const [cur] = await getDb().select().from(schema.currentLocations).where(eq(schema.currentLocations.deviceId, devA));
    expect(cur!.latitude).toBe(34.1);
    expect(cur!.recordedAt.toISOString()).toBe("2026-09-24T10:05:00.000Z");
  });

  it("no-fix records bump last_seen but store no location", async () => {
    const before = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.locationHistory);
    const t = new Date("2030-01-01T00:00:00Z");
    expect((await ingestPosition(pos({ valid: false, recordedAt: new Date("2026-09-24T11:00:00Z") }), { now: t })).status).toBe("no_fix");
    expect((await ingestPosition(pos({ latitude: 0, longitude: 0, recordedAt: new Date("2026-09-24T11:01:00Z") }))).status).toBe("no_fix");
    const after = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.locationHistory);
    expect(after[0]!.n).toBe(before[0]!.n);
    const [dev] = await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, devA));
    expect(dev!.lastSeenAt!.toISOString()).toBe(t.toISOString());
    // reset for connectivity assertions below
    await getDb().update(schema.gpsDevices).set({ lastSeenAt: new Date() }).where(eq(schema.gpsDevices.id, devA));
  });

  it("backfill mode does not touch last_seen", async () => {
    await getDb().update(schema.gpsDevices).set({ lastSeenAt: null }).where(eq(schema.gpsDevices.id, devB));
    await ingestPosition(pos({ externalDeviceId: IMEI_B, imei: IMEI_B, recordedAt: new Date("2026-09-20T08:00:00Z") }), { touchLastSeen: false });
    const [dev] = await getDb().select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, devB));
    expect(dev!.lastSeenAt).toBeNull();
  });

  it("unknown devices are rejected without writes", async () => {
    expect((await ingestPosition(pos({ externalDeviceId: "999999999999999" }))).status).toBe("unknown_device");
  });

  it("only one active assignment per device", async () => {
    await expect(
      getDb().insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: devA, vehicleId: vehicleA })
    ).rejects.toThrow();
  });
});

describe("webhook → Redis", () => {
  const payload = (fixTime: string) => ({
    position: { id: 1, deviceId: 7, fixTime, valid: true, latitude: 34.2, longitude: -118.3, speed: 10, course: 45, altitude: 90, attributes: { ignition: true, motion: true } },
    device: { id: 7, uniqueId: IMEI_A }
  });
  const post = (body: unknown) =>
    webhookPOST(
      new Request(`${BASE}/api/webhooks/traccar`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TRACCAR_WEBHOOK_SECRET}` },
        body: JSON.stringify(body)
      })
    );

  it("publishes a clean event only to the device's own org channel, after commit", async () => {
    const got: { channel: string; msg: string }[] = [];
    subscriber.on("message", (channel, msg) => got.push({ channel, msg }));
    await subscriber.subscribe(locationChannel(orgA), locationChannel(orgB));
    const res = await post(payload("2026-09-24T12:00:00Z"));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toHaveLength(1);
    expect(got[0]!.channel).toBe(locationChannel(orgA));
    const event = JSON.parse(got[0]!.msg);
    expect(event).toMatchObject({ deviceId: devA, latitude: 34.2, recordedAt: "2026-09-24T12:00:00.000Z" });
    expect(event).not.toHaveProperty("imei");
    expect(event).not.toHaveProperty("externalDeviceId");
  });

  it("duplicate and late records are acknowledged with 202 and not published", async () => {
    expect((await post(payload("2026-09-24T12:00:00Z"))).status).toBe(202);
    const late = await post(payload("2026-09-24T11:59:00Z"));
    expect(late.status).toBe(202);
    expect(await late.json()).toMatchObject({ status: "stored", current: false });
  });
});

describe("GET /api/locations/current", () => {
  it("401 without a session", async () => {
    expect((await currentGET(get("/api/locations/current"))).status).toBe(401);
  });

  it("returns only the caller's org devices with vehicle and connectivity", async () => {
    const res = await currentGET(get(`/api/locations/current?organizationId=${orgB}`, cookieA));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.devices).toHaveLength(1);
    const d = body.devices[0];
    expect(d.deviceId).toBe(devA);
    expect(d.vehicle).toMatchObject({ id: vehicleA, name: "Range Rover" });
    expect(d.connectivity).toBe("online");
    expect(d.location.latitude).toBe(34.2);
    expect(JSON.stringify(body)).not.toContain(devB);
    expect(JSON.stringify(body)).not.toContain(IMEI_A); // provider identity is not exposed
  });

  it("Org B sees only its own device", async () => {
    const body = await (await currentGET(get("/api/locations/current", cookieB))).json();
    expect(body.devices.map((d: { deviceId: string }) => d.deviceId)).toEqual([devB]);
    expect(body.devices[0].connectivity).toBe("never_seen");
  });
});

describe("GET /api/locations/history", () => {
  const q = (params: Record<string, string>) => `/api/locations/history?${new URLSearchParams(params)}`;
  const window = { from: "2026-09-24T00:00:00Z", to: "2026-09-25T00:00:00Z" };

  it("returns the device track in time order", async () => {
    const res = await historyGET(get(q({ deviceId: devA, ...window }), cookieA));
    expect(res.status).toBe(200);
    const body = await res.json();
    const times = body.points.map((p: { recordedAt: string }) => p.recordedAt);
    expect(times).toEqual([...times].sort());
    expect(times).toContain("2026-09-24T09:30:00.000Z");
    expect(body.nextCursor).toBeNull();
  });

  it("paginates with a stable cursor and no gaps or repeats", async () => {
    const all = (await (await historyGET(get(q({ deviceId: devA, ...window }), cookieA))).json()).points;
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const params: Record<string, string> = { deviceId: devA, ...window, limit: "2" };
      if (cursor) params.cursor = cursor;
      const body = await (await historyGET(get(q(params), cookieA))).json();
      seen.push(...body.points.map((p: { recordedAt: string }) => p.recordedAt));
      cursor = body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.map((p: { recordedAt: string }) => p.recordedAt));
  });


  it("a long window (more than 20,000 points) comes back whole as an overview with all-point totals", async () => {
    const db = getDb();
    // 30,000 points every 10 s from Sep 10 (about 3.5 days), heading east, with a 1-hour stop in the middle.
    await db.execute(sql`
      insert into location_history (organization_id, device_id, recorded_at, latitude, longitude, speed_kph, heading_deg, altitude_m, ignition, motion)
      select ${orgA}, ${devA}, timestamptz '2026-09-10T00:00:00Z' + (g * interval '10 seconds'),
             34.0, -118.0 + least(g, 15000) * 0.0005 + greatest(g - 15360, 0) * 0.0005,
             case when g between 15001 and 15360 then 0 else 20 end, 90, 80,
             g not between 15001 and 15360, g not between 15001 and 15360
      from generate_series(0, 29999) g`);
    const longWin = { from: "2026-09-10T00:00:00Z", to: "2026-09-14T00:00:00Z" };
    const res = await historyGET(get(q({ deviceId: devA, ...longWin, limit: "5000", detail: "auto" }), cookieA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextCursor).toBeNull();
    expect(body.overview.totalPoints).toBe(30000);
    expect(body.points.length).toBeLessThan(20000);
    const times: string[] = body.points.map((p: { recordedAt: string }) => p.recordedAt);
    expect(times).toEqual([...times].sort());
    expect(times[0]).toBe("2026-09-10T00:00:00.000Z");
    expect(times.at(-1)).toBe(new Date(Date.parse("2026-09-10T00:00:00Z") + 29999 * 10_000).toISOString());
    // The stop keeps its real start and end.
    expect(times).toContain(new Date(Date.parse("2026-09-10T00:00:00Z") + 15001 * 10_000).toISOString());
    expect(times).toContain(new Date(Date.parse("2026-09-10T00:00:00Z") + 15361 * 10_000).toISOString());

    // Full detail still pages through every point, and the overview's distance matches it.
    const all: Parameters<typeof trackStats>[0] = [];
    let cursor: string | null = null;
    do {
      const params: Record<string, string> = { deviceId: devA, ...longWin, limit: "5000" };
      if (cursor) params.cursor = cursor;
      const page = await (await historyGET(get(q(params), cookieA))).json();
      all.push(...page.points);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all.length).toBe(30000);
    const full = trackStats(all);
    expect(Math.abs(body.overview.distanceKm - full.km) / full.km).toBeLessThan(0.001);
    expect(body.overview.maxSpeedKph).toBe(20);

    // A short window with detail=auto is unchanged: plain points, no overview.
    const short = await (await historyGET(get(q({ deviceId: devA, ...window, detail: "auto" }), cookieA))).json();
    expect(short.overview).toBeUndefined();
  });

  it("another org's device is indistinguishable from a missing one (404)", async () => {
    const foreign = await historyGET(get(q({ deviceId: devB, ...window }), cookieA));
    const missing = await historyGET(get(q({ deviceId: "00000000-0000-4000-8000-000000000000", ...window }), cookieA));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("validates input", async () => {
    const bad = async (p: Record<string, string>) => (await historyGET(get(q(p), cookieA))).status;
    expect(await bad({ deviceId: "not-a-uuid" })).toBe(400);
    expect(await bad({ deviceId: devA, from: "2026-09-25T00:00:00Z", to: "2026-09-24T00:00:00Z" })).toBe(400);
    expect(await bad({ deviceId: devA, from: "2026-01-01T00:00:00Z", to: "2026-09-24T00:00:00Z" })).toBe(400);
    expect(await bad({ deviceId: devA, ...window, limit: "5001" })).toBe(400);
    expect(await bad({ deviceId: devA, ...window, cursor: "garbage" })).toBe(400);
  });

  it("401 without a session", async () => {
    expect((await historyGET(get(q({ deviceId: devA, ...window })))).status).toBe(401);
  });
});
