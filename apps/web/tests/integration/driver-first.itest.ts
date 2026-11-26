import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers";
import { createDriver } from "@/lib/drivers";
import { createDriverInvite } from "@/lib/driver-app";
import { requestDriverAgain } from "@/lib/driver-links";
import { listPlans } from "@/lib/plans";
import { createLoad, LoadInputSchema } from "@/lib/loads";
import { GET as requestsAllGET } from "@/app/api/driver-app/requests/route";
import { POST as loadAnswerPOST } from "@/app/api/driver-app/loads/[id]/route";
import { POST as redeemPOST } from "@/app/api/driver-app/invite/route";
import { GET as meGET, PATCH as mePATCH } from "@/app/api/driver-app/me/route";
import { GET as requestsGET } from "@/app/api/driver-app/requests/route";
import { POST as respondPOST } from "@/app/api/driver-app/requests/[id]/route";
import { POST as leavePOST } from "@/app/api/driver-app/companies/[id]/leave/route";
import { GET as statsGET } from "@/app/api/driver-app/stats/route";
import { GET as loadsGET } from "@/app/api/driver-app/loads/route";
import { POST as reportPOST } from "@/app/api/driver-app/report/route";

const BASE = "http://localhost:3000";
const meta = { ipAddress: null, userAgent: null };
const PHONE = "+14165550199";
let orgA = "";
let orgB = "";
let rootId = "";
let driverA = "";
let driverB = "";
let token = "";

const app = (method: string, path: string, body?: unknown, bearer = token) =>
  new Request(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ctx = (organizationId: string) => ({ userId: rootId, organizationId, role: "ORG_ADMIN" as const, isSuperAdmin: true });

let minute = 0;
async function report() {
  minute += 1;
  const at = new Date(Date.now() - (60 - minute) * 60_000).toISOString();
  const res = await reportPOST(app("POST", "/api/driver-app/report", { points: [{ latitude: 43.7 + minute / 1000, longitude: -79.4, speedKph: 60, accuracyM: 8, recordedAt: at }], permission: "always", locationEnabled: true }));
  expect(res.status).toBeLessThan(300);
}
async function pointsFor(organizationId: string): Promise<number> {
  const [r] = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from location_history where organization_id = ${organizationId}`);
  return Number(r?.n ?? 0);
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const plans = Object.fromEntries((await listPlans()).map((p) => [p.name, p.id]));
  const [root] = await db.insert(schema.users).values({ email: "root@first.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  rootId = root!.id;
  orgA = (await createCustomer(rootId, { name: "Alpha Carriers", slug: "alpha-carriers", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free Basic"], admin: { email: "a@first.test", name: "A" } }, meta)).organizationId;
  orgB = (await createCustomer(rootId, { name: "Bravo Logistics", slug: "bravo-logistics", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free Basic"], admin: { email: "b@first.test", name: "B" } }, meta)).organizationId;
});
afterAll(async () => {
  await closeDb();
});

describe("driver-first links", () => {
  it("a driver added by phone waits for the driver; the company's link signs them in and accepts", async () => {
    const d = await createDriver(ctx(orgA), { name: "Sam Patel", phone: PHONE } as never, meta);
    expect(d.appLink).toBe("pending");
    driverA = d.id;
    const inv = await createDriverInvite(ctx(orgA), driverA, rootId);
    const t = new URL(inv.url).searchParams.get("t")!;
    const res = await redeemPOST(app("POST", "/api/driver-app/invite", { token: t, device: { platform: "android" } }, ""));
    expect(res.status).toBe(201);
    token = ((await res.json()) as { token: string }).token;
    const [row] = await getDb().select({ appLink: schema.drivers.appLink }).from(schema.drivers).where(eq(schema.drivers.id, driverA));
    expect(row!.appLink).toBe("active");
    await report();
    expect(await pointsFor(orgA)).toBe(1);
  });

  it("a second company asks; it sees nothing until the driver accepts, then gets the same phone", async () => {
    const d = await createDriver(ctx(orgB), { name: "Sam P.", phone: PHONE } as never, meta);
    driverB = d.id;
    const list = (await (await requestsGET(app("GET", "/api/driver-app/requests"))).json()) as { requests: { id: string; company: { name: string } }[]; companies: { id: string }[] };
    expect(list.requests).toEqual([expect.objectContaining({ id: driverB, company: expect.objectContaining({ name: "Bravo Logistics" }) })]);
    expect(list.companies.map((c) => c.id)).toEqual([driverA]);
    const me = (await (await meGET(app("GET", "/api/driver-app/me"))).json()) as { pendingRequests: number; companiesSharing: number };
    expect(me).toMatchObject({ pendingRequests: 1, companiesSharing: 1 });

    await report();
    expect(await pointsFor(orgB)).toBe(0);

    const ok = await respondPOST(app("POST", `/api/driver-app/requests/${driverB}`, { accept: true }), params(driverB));
    expect(ok.status).toBe(200);
    const after = (await ok.json()) as { companies: { id: string }[]; requests: unknown[] };
    expect(after.requests).toHaveLength(0);
    expect(after.companies.map((c) => c.id).sort()).toEqual([driverA, driverB].sort());
    // Can't answer twice.
    expect((await respondPOST(app("POST", `/api/driver-app/requests/${driverB}`, { accept: false }), params(driverB))).status).toBe(400);

    await report();
    expect(await pointsFor(orgB)).toBe(1);
    expect(await pointsFor(orgA)).toBe(3);
  });

  it("loads from both companies show with where they came from", async () => {
    const ins = (org: string, ref: string) =>
      getDb().execute(sql`insert into loads (organization_id, reference, status, tracking_mode, driver_phone, pickup_address, pickup_lat, pickup_lon, delivery_address, delivery_lat, delivery_lon, driver_token_hash)
        values (${org}, ${ref}, 'tracking', 'phone', ${PHONE}, 'A', 43.7, -79.4, 'B', 45.5, -73.6, ${`h-${ref}`})`);
    await ins(orgA, "A-1");
    await ins(orgB, "B-1");
    const { loads } = (await (await loadsGET(app("GET", "/api/driver-app/loads"))).json()) as { loads: { reference: string; from: { name: string } }[] };
    expect(loads.map((l) => `${l.reference}:${l.from.name}`).sort()).toEqual(["A-1:Alpha Carriers", "B-1:Bravo Logistics"]);
  });

  it("a broker's load to the driver's number is a request; accepting tells the driver's companies", async () => {
    const plans = Object.fromEntries((await listPlans()).map((p) => [p.name, p.id]));
    const orgC = (await createCustomer(rootId, { name: "Charlie Brokers", slug: "charlie-brokers", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Loads Starter"] ?? plans["Free Basic"], admin: { email: "c@first.test", name: "C" } }, meta)).organizationId;
    const stop = (lat: number) => ({ name: null, address: "Somewhere", latitude: lat, longitude: -79.4, radiusM: 500, appointmentAt: null });
    const created = await createLoad(ctx(orgC), LoadInputSchema.parse({ reference: "C-1", driverPhone: PHONE, driverName: "Sam", pickup: stop(43.7), delivery: stop(45.5) }), meta);
    expect(created.hasApp).toBe(true);
    const r = (await (await requestsAllGET(app("GET", "/api/driver-app/requests"))).json()) as { loads: { id: string; from: { name: string } }[] };
    expect(r.loads).toEqual([expect.objectContaining({ id: created.id, from: expect.objectContaining({ name: "Charlie Brokers" }) })]);
    // Not in the loads list until accepted.
    const before = (await (await loadsGET(app("GET", "/api/driver-app/loads"))).json()) as { loads: { id: string }[] };
    expect(before.loads.map((l) => l.id)).not.toContain(created.id);
    const ok = await loadAnswerPOST(app("POST", `/api/driver-app/loads/${created.id}`, { action: "accept" }), params(created.id));
    expect(ok.status).toBe(200);
    const after = (await ok.json()) as { loads: { id: string; kind: string; from: { name: string } }[]; requests: unknown[] };
    expect(after.requests).toHaveLength(0);
    expect(after.loads.find((l) => l.id === created.id)).toMatchObject({ kind: "outside", from: { name: "Charlie Brokers" } });
    const told = await getDb().execute<{ org: string }>(sql`select organization_id as org from audit_logs where action = 'driver.accepted_outside_load'`);
    expect(told.map((t) => t.org).sort()).toEqual([orgA, orgB].sort());
    // The broker gets the load's positions (from Accept on), not the driver's history.
    await reportPOST(app("POST", "/api/driver-app/report", { points: [{ latitude: 43.8, longitude: -79.4, speedKph: 60, accuracyM: 8, recordedAt: new Date().toISOString() }], permission: "always", locationEnabled: true }));
    const [pings] = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from load_pings where load_id = ${created.id}`);
    expect(Number(pings!.n)).toBe(1);
    expect(await pointsFor(orgC)).toBe(0);
  });

  it("the driver edits their profile once for every company", async () => {
    const res = await mePATCH(app("PATCH", "/api/driver-app/me", { name: "Samir Patel", email: "Sam@Example.com", licenseNumber: "P1234-56789" }));
    expect(res.status).toBe(200);
    const rows = await getDb().select({ name: schema.drivers.name, email: schema.drivers.email, lic: schema.drivers.licenseNumber }).from(schema.drivers).where(eq(schema.drivers.phone, PHONE));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toEqual({ name: "Samir Patel", email: "sam@example.com", lic: "P1234-56789" });
    expect((await mePATCH(app("PATCH", "/api/driver-app/me", { email: "nope" }))).status).toBe(400);
  });

  it("stats answer for today, week and month", async () => {
    const db = getDb();
    const [a] = await db.select({ dev: schema.drivers.phoneDeviceId }).from(schema.drivers).where(eq(schema.drivers.id, driverA));
    const [b] = await db.select({ dev: schema.drivers.phoneDeviceId }).from(schema.drivers).where(eq(schema.drivers.id, driverB));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const row = { day, timeZone: "America/Toronto", drivingS: 3600, idleS: 300, trips: 2, maxSpeedKph: 98 };
    await db.insert(schema.deviceDailyStats).values({ organizationId: orgA, deviceId: a!.dev!, distanceM: 80_000, ...row });
    await db.insert(schema.deviceDailyStats).values({ organizationId: orgB, deviceId: b!.dev!, distanceM: 50_000, ...row });
    const today = (await (await statsGET(app("GET", "/api/driver-app/stats?range=today"))).json()) as { totals: { distanceKm: number; drivingMin: number; trips: number }; byCompany: { company: { name: string }; distanceKm: number }[]; days: unknown[] };
    // The same phone reported to both companies: the day counts once.
    expect(today.totals).toMatchObject({ distanceKm: 80, drivingMin: 60, trips: 2 });
    expect(today.days).toHaveLength(1);
    expect(today.byCompany.map((c) => `${c.company.name}:${c.distanceKm}`).sort()).toEqual(["Alpha Carriers:80", "Bravo Logistics:50"]);
    const month = (await (await statsGET(app("GET", "/api/driver-app/stats?range=month"))).json()) as { days: unknown[] };
    expect(month.days).toHaveLength(30);
  });

  it("leaving a company stops its location; leaving the last one ends the sign-in; the company can ask again", async () => {
    const before = await pointsFor(orgB);
    const res = await leavePOST(app("POST", `/api/driver-app/companies/${driverB}/leave`), params(driverB));
    expect(((await res.json()) as { signedOut: boolean }).signedOut).toBe(false);
    await report();
    expect(await pointsFor(orgB)).toBe(before);

    expect(await requestDriverAgain(orgB, driverB, rootId)).toBe("pending");
    const list = (await (await requestsGET(app("GET", "/api/driver-app/requests"))).json()) as { requests: { id: string }[] };
    expect(list.requests.map((r) => r.id)).toEqual([driverB]);
    // Decline it.
    await respondPOST(app("POST", `/api/driver-app/requests/${driverB}`, { accept: false }), params(driverB));
    const [b] = await getDb().select({ appLink: schema.drivers.appLink }).from(schema.drivers).where(and(eq(schema.drivers.id, driverB)));
    expect(b!.appLink).toBe("declined");

    const last = await leavePOST(app("POST", `/api/driver-app/companies/${driverA}/leave`), params(driverA));
    expect(((await last.json()) as { signedOut: boolean }).signedOut).toBe(true);
    expect((await meGET(app("GET", "/api/driver-app/me"))).status).toBe(401);
  });
});
