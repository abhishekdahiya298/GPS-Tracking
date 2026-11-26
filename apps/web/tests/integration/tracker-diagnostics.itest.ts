import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setTraccarDiagnosticsForTests } from "@/lib/tracker-diagnostics";
import { GET as diagGET } from "@/app/api/admin/trackers/[id]/diagnostics/route";
import { POST as commandPOST } from "@/app/api/admin/trackers/[id]/command/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "868038076567552";
const cookies: Record<string, string> = {};
let ipN = 40;
let trackerId = "";
const sent: { deviceId: number; data: string }[] = [];
let positions: unknown[] = [];

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `192.0.2.${ipN++}` },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const get = (who: string, qs = "") => new Request(`${BASE}/api/admin/trackers/${trackerId}/diagnostics${qs}`, { headers: { cookie: cookies[who]! } });
const post = (who: string, body: unknown) => new Request(`${BASE}/x`, { method: "POST", headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
/** Like TRAILER-203 on 2026-11-26: reporting every minute, 0 satellites, no vehicle power. */
const noFix = (minAgo: number, attrs: Record<string, unknown> = {}) => ({
  deviceTime: at(minAgo),
  fixTime: at(minAgo),
  serverTime: at(minAgo),
  valid: false,
  latitude: 0,
  longitude: 0,
  speed: 0,
  protocol: "teltonika",
  attributes: { sat: 0, io69: 2, hdop: 100, power: 0.156, battery: 4.04, ignition: false, motion: true, rssi: 2, ...attrs }
});

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, sim_cards, gps_devices restart identity cascade`);
  const [org] = await db.insert(schema.organizations).values({ name: "Rio Panjeta Trucking", slug: "rio" }).returning();
  await createUserWithMembership({ email: "root@platform.test", name: "Root", password: PASSWORD, superAdmin: true });
  await createUserWithMembership({ email: "admin@rio.test", name: "Customer admin", password: PASSWORD, organizationSlug: "rio", role: "ORG_ADMIN" });
  cookies.root = await signIn("root@platform.test");
  cookies.customer = await signIn("admin@rio.test");
  const [d] = await db
    .insert(schema.gpsDevices)
    .values({ organizationId: org!.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM164", lastSeenAt: new Date(Date.now() - 60_000) })
    .returning();
  trackerId = d!.id;
  positions = [noFix(30), noFix(2), noFix(1, { result: "GPS:0 POWER:1 Sat:0 LAT:0 LON:0 Date:1970-01-01 Time:00:00:00" })];
  setTraccarDiagnosticsForTests({
    async findDeviceByUniqueId(uniqueId) {
      return uniqueId === IMEI ? { id: 3, status: "online", lastUpdate: at(1) } : null;
    },
    async listPositions() {
      return positions;
    },
    async sendCommand(deviceId, data) {
      sent.push({ deviceId, data });
      return "sent";
    }
  });
});

afterAll(async () => {
  setTraccarDiagnosticsForTests(null);
  await closeDb();
});

describe("tracker diagnostics (Platform console)", () => {
  it("is for super admins only", async () => {
    expect((await diagGET(get("customer"), p(trackerId))).status).toBe(403);
    expect((await commandPOST(post("customer", { command: "getgps" }), p(trackerId))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("explains a tracker that reports but has no GPS and no vehicle power", async () => {
    const res = await diagGET(get("root", "?hours=6"), p(trackerId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const d = await res.json();
    expect(d.range.hours).toBe(6);
    expect(d.traccar).toMatchObject({ connected: true, protocol: "teltonika", error: null });
    expect(d.verdict.level).toBe("bad");
    const by = Object.fromEntries(d.checks.map((c: { id: string; level: string }) => [c.id, c.level]));
    expect(by).toEqual({ connection: "ok", gps: "bad", power: "warn", battery: "ok", signal: "ok" });
    expect(d.totals).toEqual({ reports: 3, fixes: 0, truncated: false });
    expect(d.buckets.length).toBeGreaterThanOrEqual(6);
    expect(d.buckets.length).toBeLessThanOrEqual(7); // a window not starting on the hour spans one extra partial hour
    expect(d.replies[0].text).toContain("Sat:0");
    expect(d.recent[0].satellites).toBe(0);
    expect(d.tracker).toMatchObject({ imei: IMEI, customer: { name: "Rio Panjeta Trucking" } });
  });

  it("returns only new command replies when polling with since", async () => {
    const res = await diagGET(get("root", `?since=${encodeURIComponent(at(1.5))}`), p(trackerId));
    const d = await res.json();
    expect(d.replies).toHaveLength(1);
    expect(d.replies[0].text).toContain("GPS:0");
  });

  it("sends only allowlisted read-only commands and audits each one", async () => {
    expect((await commandPOST(post("root", { command: "cpureset" }), p(trackerId))).status).toBe(400);
    expect((await commandPOST(post("root", { command: "setparam 2004:evil.example" }), p(trackerId))).status).toBe(400);
    const res = await commandPOST(post("root", { command: "getgps" }), p(trackerId));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "sent", command: "getgps" });
    expect(sent).toEqual([{ deviceId: 3, data: "getgps" }]);
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "device.command_sent"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetId: trackerId, metadata: { imei: IMEI, command: "getgps", outcome: "sent" } });
  });

  it("rate limits commands per tracker", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await commandPOST(post("root", { command: "getinfo" }), p(trackerId))).status);
    expect(statuses).toContain(429);
  });

  it("answers 404 for an unknown or invalid tracker id", async () => {
    expect((await diagGET(get("root"), p("00000000-0000-0000-0000-000000000000"))).status).toBe(404);
    expect((await diagGET(get("root"), p("not-a-uuid"))).status).toBe(404);
  });
});
