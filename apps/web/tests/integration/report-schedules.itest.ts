import "./setup-env";
import type { TenantContext } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { ingestPosition } from "@/lib/ingest";
import { createSchedule, runReportSchedules } from "@/lib/report-schedules";
import { DELETE as schedDELETE, PATCH as schedPATCH } from "@/app/api/report-schedules/[id]/route";
import { POST as testPOST } from "@/app/api/report-schedules/[id]/test/route";
import { GET as listGET, POST as createPOST } from "@/app/api/report-schedules/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const IMEI = "864361078566115";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let orgA = "", orgB = "", devA = "", devB = "";
const outbox: EmailMessage[] = [];
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `192.0.2.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function req(method: string, who: string, body?: unknown) {
  return new Request(`${BASE}/api/report-schedules`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const ctxA = (): TenantContext => ({ userId: ids.admin!, organizationId: orgA, role: "ORG_ADMIN", isSuperAdmin: false });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  orgA = (await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning())[0]!.id;
  orgB = (await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning())[0]!.id;
  const pa = (await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  const pb = (await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning())[0]!;
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa.id, externalDeviceId: IMEI, imei: IMEI, model: "FTM880" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb.id, externalDeviceId: "350000000000088", imei: "350000000000088" }).returning())[0]!.id;
  const v = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "=Truck 7" }).returning())[0]!;
  await db.insert(schema.deviceAssignments).values({ organizationId: orgA, deviceId: devA, vehicleId: v.id });
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "VIEWER") => createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role });
  await mk("admin@a.test", "org-a", "ORG_ADMIN");
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("bob@b.test", "org-b", "ORG_ADMIN");
  for (const k of ["admin", "fleet", "viewer", "bob"]) {
    const email = `${k}@${k === "bob" ? "b" : "a"}.test`;
    cookies[k] = await signIn(email);
    ids[k] = (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0]!.id;
  }
  // One 10-minute drive on 2026-09-24 (UTC), ~5 km at 30 km/h.
  const t0 = Date.parse("2026-09-24T12:00:00Z");
  for (let i = 0; i <= 10; i++) {
    await ingestPosition({ externalDeviceId: IMEI, imei: IMEI, latitude: 43.6 + i * 0.0045, longitude: -79.7, speedKph: i === 10 ? 0 : 30, headingDeg: 0, altitudeM: 0, recordedAt: new Date(t0 + i * 60_000), valid: true, ignition: i < 10, motion: i < 10 });
  }
  setEmailTransportForTests(async (m) => {
    outbox.push(m);
  });
});
beforeEach(() => {
  outbox.length = 0;
});
afterAll(async () => {
  setEmailTransportForTests(null);
  await closeDb();
});

const libInput = () => ({ name: "Daily summary", frequency: "daily" as const, timeZone: "UTC", sendHour: 7, weekday: 1, deviceIds: null, recipientUserIds: [ids.admin!, ids.viewer!], attachCsv: true, active: true });
const valid = () => ({ name: "Daily summary", frequency: "daily", timeZone: "UTC", sendHour: 7, recipientUserIds: [ids.admin, ids.viewer] });

describe("report schedules: access", () => {
  it("VIEWER cannot list or create; FLEET_MANAGER can", async () => {
    expect((await listGET(req("GET", "viewer"))).status).toBe(403);
    expect((await createPOST(req("POST", "viewer", valid()))).status).toBe(403);
    expect((await createPOST(req("POST", "fleet", valid()))).status).toBe(201);
  });

  it("rejects recipients or devices from another organization, and bad time zones", async () => {
    expect((await createPOST(req("POST", "admin", { ...valid(), recipientUserIds: [ids.bob] }))).status).toBe(400);
    expect((await createPOST(req("POST", "admin", { ...valid(), deviceIds: [devB] }))).status).toBe(400);
    expect((await createPOST(req("POST", "admin", { ...valid(), timeZone: "Mars/Olympus" }))).status).toBe(400);
    expect((await createPOST(req("POST", "admin", { ...valid(), sendHour: 24 }))).status).toBe(400);
  });

  it("other organizations can't see, change, delete or test a schedule", async () => {
    const { id } = await (await createPOST(req("POST", "admin", valid()))).json();
    const bobList = await (await listGET(req("GET", "bob"))).json();
    expect(bobList.schedules).toHaveLength(0);
    expect((await schedPATCH(req("PATCH", "bob", { active: false }), p(id))).status).toBe(404);
    expect((await schedDELETE(req("DELETE", "bob"), p(id))).status).toBe(404);
    expect((await testPOST(req("POST", "bob"), p(id))).status).toBe(404);
    expect((await schedDELETE(req("DELETE", "admin"), p(id))).status).toBe(204);
  });
});

describe("report schedules: delivery", () => {
  let schedId = "";
  it("a schedule created after today's send time waits for the next period", async () => {
    await getDb().delete(schema.reportSchedules);
    await createSchedule(ctxA(), libInput(), { ipAddress: null, userAgent: null }, new Date("2026-09-25T10:00:00Z"));
    expect(await runReportSchedules(new Date("2026-09-25T10:05:00Z"))).toBe(0);
    expect(outbox).toHaveLength(0);
    await getDb().delete(schema.reportSchedules);
  });

  it("sends yesterday's summary once to each member recipient, with a safe CSV", async () => {
    schedId = await createSchedule(ctxA(), libInput(), { ipAddress: null, userAgent: null }, new Date("2026-09-24T06:00:00Z"));
    const now = new Date("2026-09-25T07:05:00Z");
    // Two overlapping passes (e.g. two instances) must not double-send.
    const [a, b] = await Promise.all([runReportSchedules(now), runReportSchedules(now)]);
    expect(a + b).toBe(1);
    expect(outbox.map((m) => m.to).sort()).toEqual(["admin@a.test", "viewer@a.test"]);
    const m = outbox[0]!;
    expect(m.subject).toContain("2026-09-24");
    expect(m.text).toContain("=Truck 7: 1 trip, 4.5 km, 0h 09m driving, top 30 km/h");
    expect(m.html).not.toContain("<script");
    const csv = m.attachments![0]!;
    expect(csv.filename).toBe("trips-daily-2026-09-24.csv");
    expect(csv.content.split("\r\n")[1]).toMatch(/^'=Truck 7,/); // formula injection neutralised
    outbox.length = 0;
    expect(await runReportSchedules(new Date("2026-09-25T20:00:00Z"))).toBe(0);
    expect(outbox).toHaveLength(0);
    const [row] = await getDb().select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, schedId));
    expect(row!.lastStatus).toBe("sent to 2");
  });

  it("a recipient removed from the organization stops receiving it", async () => {
    await getDb().delete(schema.memberships).where(and(eq(schema.memberships.userId, ids.viewer!), eq(schema.memberships.organizationId, orgA)));
    expect(await runReportSchedules(new Date("2026-09-26T07:05:00Z"))).toBe(1);
    expect(outbox.map((m) => m.to)).toEqual(["admin@a.test"]);
  });

  it("paused schedules don't send", async () => {
    expect((await schedPATCH(req("PATCH", "admin", { active: false }), p(schedId))).status).toBe(200);
    expect(await runReportSchedules(new Date("2026-09-27T07:05:00Z"))).toBe(0);
  });

  it("'send me a test' goes to the caller only, and is rate limited", async () => {
    const res = await testPOST(req("POST", "fleet"), p(schedId));
    expect(res.status).toBe(200);
    expect(outbox.map((m) => m.to)).toEqual(["fleet@a.test"]);
    expect((await testPOST(req("POST", "fleet"), p(schedId))).status).toBe(429);
    const actions = (await getDb().select({ a: schema.auditLogs.action }).from(schema.auditLogs)).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["report_schedule.created", "report_schedule.updated", "report_schedule.test_sent"]));
  });
});
