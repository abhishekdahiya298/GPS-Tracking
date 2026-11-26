import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { createCustomer } from "@/lib/customers";
import { listPlans } from "@/lib/plans";
import { DriverListQuery, listDriversPage } from "@/lib/drivers";
import { driversForMap } from "@/lib/driver-app";
import { POST as invitePOST } from "@/app/api/drivers/[id]/app-invite/route";
import { POST as companySignoutPOST } from "@/app/api/drivers/[id]/app-signout/route";
import { GET as statusGET } from "@/app/api/drivers/app-status/route";
import { GET as peekGET, POST as redeemPOST } from "@/app/api/driver-app/invite/route";
import { GET as meGET } from "@/app/api/driver-app/me/route";
import { GET as loadsGET } from "@/app/api/driver-app/loads/route";
import { POST as reportPOST } from "@/app/api/driver-app/report/route";
import { POST as signoutPOST } from "@/app/api/driver-app/signout/route";
import { PUT as pushPUT } from "@/app/api/driver-app/push/route";
import { POST as askPOST } from "@/app/api/drivers/[id]/ask-location/route";
import { setPushTransportForTests, type PushMessage } from "@/lib/push";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { POST as phoneStartPOST } from "@/app/api/driver-app/phone/start/route";
import { POST as phoneVerifyPOST } from "@/app/api/driver-app/phone/verify/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const meta = { ipAddress: null, userAgent: null };
let cookie = "";
let orgId = "";
let driverId = "";
let vehicleId = "";
let token = "";

const web = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const app = (method: string, path: string, body?: unknown, bearer = token) =>
  new Request(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.7" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const plans = Object.fromEntries((await listPlans()).map((p) => [p.name, p.id]));
  const [pf] = await db.insert(schema.users).values({ email: "root@rio.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  orgId = (await createCustomer(pf!.id, { name: "Phone Freight", slug: "phone-freight", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free Basic"], admin: { email: "first@phone.test", name: "First" } }, meta)).organizationId;
  await createUserWithMembership({ email: "owner@phone.test", name: "Owner", password: PASSWORD, organizationSlug: "phone-freight", role: "ORG_ADMIN" });
  const res = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "198.18.9.1" }, body: JSON.stringify({ email: "owner@phone.test", password: PASSWORD }) }));
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const [v] = await db.insert(schema.vehicles).values({ organizationId: orgId, name: "Truck 7", type: "truck" }).returning();
  vehicleId = v!.id;
  const [d] = await db.insert(schema.drivers).values({ organizationId: orgId, name: "Priya Nair", phone: "+14165550101", vehicleId }).returning();
  driverId = d!.id;
});
afterAll(async () => {
  await closeDb();
});

describe("driver app", () => {
  it("the company makes a personal link; the app signs in with it once", async () => {
    const res = await invitePOST(web("POST", `/api/drivers/${driverId}/app-invite`, {}), params(driverId));
    expect(res.status).toBe(201);
    const { invite } = (await res.json()) as { invite: { url: string; appUrl: string } };
    expect(invite.url).toMatch(/\/driver-app\?t=/);
    const t = new URL(invite.url).searchParams.get("t")!;
    const peek = async (q: string) => (await (await peekGET(app("GET", `/api/driver-app/invite?t=${q}`, undefined, ""))).json()) as { state: string; companyName?: string };
    expect(await peek(t)).toMatchObject({ state: "ok", companyName: "Phone Freight" });
    expect((await peek("x".repeat(20))).state).toBe("unknown");
    const signIn = await redeemPOST(app("POST", "/api/driver-app/invite", { token: t, device: { platform: "ios", appVersion: "2.2.0" } }, ""));
    expect(signIn.status).toBe(201);
    const s = (await signIn.json()) as { token: string; company: { name: string } };
    expect(s.company.name).toBe("Phone Freight");
    token = s.token;
    // Single use.
    expect((await redeemPOST(app("POST", "/api/driver-app/invite", { token: t }, ""))).status).toBe(400);
    expect((await peek(t)).state).toBe("used");
    const me = (await (await meGET(app("GET", "/api/driver-app/me"))).json()) as { vehicle: { name: string } };
    expect(me.vehicle.name).toBe("Truck 7");
    // A load on the driver's truck shows in the driver app; nothing else does.
    await getDb().execute(sql`insert into loads (organization_id, reference, status, tracking_mode, vehicle_id, pickup_address, pickup_lat, pickup_lon, delivery_address, delivery_lat, delivery_lon, driver_token_hash)
      values (${orgId}, 'L-7001', 'tracking', 'vehicle', ${vehicleId}, '1 Peel St', 43.7, -79.7, '2 Rue Cohen', 45.5, -73.6, 'x1'), (${orgId}, 'L-7002', 'tracking', 'phone', null, 'A', 43, -79, 'B', 44, -78, 'x2')`);
    const loads = (await (await loadsGET(app("GET", "/api/driver-app/loads"))).json()) as { loads: { reference: string }[] };
    expect(loads.loads.map((l) => l.reference)).toEqual(["L-7001"]);
  });

  it("phone points go through the tracker pipeline; the phone stands for a truck without a tracker", async () => {
    const t0 = Date.now() - 60_000;
    const res = await reportPOST(
      app("POST", "/api/driver-app/report", {
        points: [
          { latitude: 43.7, longitude: -79.7, speedKph: 80, recordedAt: new Date(t0).toISOString(), accuracyM: 8 },
          { latitude: 43.71, longitude: -79.69, speedKph: 82, recordedAt: new Date(t0 + 30_000).toISOString(), accuracyM: 6 },
          { latitude: 43.0, longitude: -79.0, recordedAt: new Date(t0 + 40_000).toISOString(), accuracyM: 1500 }
        ],
        battery: { pct: 64, charging: false },
        permission: "always",
        locationEnabled: true
      })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stored: number }).stored).toBe(2); // the 1.5 km guess is dropped
    const db = getDb();
    const [drv] = await db.select({ dev: schema.drivers.phoneDeviceId }).from(schema.drivers).where(eq(schema.drivers.id, driverId));
    const [dev] = await db.select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, drv!.dev!));
    expect(dev).toMatchObject({ kind: "phone", organizationId: orgId });
    const [cur] = await db.select().from(schema.currentLocations).where(eq(schema.currentLocations.deviceId, dev!.id));
    expect(cur!.latitude).toBeCloseTo(43.71);
    const [asg] = await db.select().from(schema.deviceAssignments).where(and(eq(schema.deviceAssignments.deviceId, dev!.id), isNull(schema.deviceAssignments.unassignedAt)));
    expect(asg!.vehicleId).toBe(vehicleId);
    // Phones are not trackers: not on the plan's tracker count.
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from gps_devices where organization_id = ${orgId} and kind = 'tracker'`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
    const st = (await (await statusGET(web("GET", "/api/drivers/app-status"))).json()) as { drivers: { driverId: string; state: string; batteryPct: number }[] };
    expect(st.drivers.find((d) => d.driverId === driverId)).toMatchObject({ state: "sharing", batteryPct: 64 });
    // Drivers page: "Sharing" filter and the row's battery; live map: the driver is on the truck's phone.
    const page = await listDriversPage(orgId, DriverListQuery.parse({ state: "sharing" }));
    expect(page.counts).toMatchObject({ sharing: 1, no_app: 0 });
    expect(page.items[0]!.app).toMatchObject({ state: "sharing", batteryPct: 64 });
    const [onMap] = await driversForMap(orgId);
    expect(onMap).toMatchObject({ id: driverId, source: "phone", vehicle: { id: vehicleId } });
  });

  it("the company can ask the driver to turn location on, once every 15 minutes", async () => {
    const sentMsgs: PushMessage[] = [];
    setPushTransportForTests(async (m) => (sentMsgs.push(...m), m.map(() => ({ ok: true }))));
    // No push address yet: the company is told to call.
    expect((await askPOST(web("POST", `/api/drivers/${driverId}/ask-location`, {}), params(driverId))).status).toBe(400);
    expect((await pushPUT(app("PUT", "/api/driver-app/push", { token: "ExponentPushToken[abc123def456]" }))).status).toBe(204);
    const res = await askPOST(web("POST", `/api/drivers/${driverId}/ask-location`, { message: "Turn it on for L-2041" }), params(driverId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sent: number }).sent).toBe(1);
    expect(sentMsgs[0]).toMatchObject({ to: "ExponentPushToken[abc123def456]", body: "Turn it on for L-2041", data: { type: "location_request" } });
    expect((await askPOST(web("POST", `/api/drivers/${driverId}/ask-location`, {}), params(driverId))).status).toBe(429);
    const me = (await (await meGET(app("GET", "/api/driver-app/me"))).json()) as { locationRequest: { from: string } | null };
    expect(me.locationRequest?.from).toBe("Owner");
    const st = (await (await statusGET(web("GET", "/api/drivers/app-status"))).json()) as { drivers: { driverId: string; canNotify: boolean; locationAskedAt: string | null }[] };
    expect(st.drivers.find((d) => d.driverId === driverId)).toMatchObject({ canNotify: true });
    setPushTransportForTests(null);
  });

  it("location off shows as location off", async () => {
    await reportPOST(app("POST", "/api/driver-app/report", { points: [], permission: "off", battery: { pct: 40 } }));
    const st = (await (await statusGET(web("GET", "/api/drivers/app-status"))).json()) as { drivers: { driverId: string; state: string }[] };
    expect(st.drivers.find((d) => d.driverId === driverId)!.state).toBe("location_off");
  });

  it("signing out stops sharing; the company can sign a driver out too", async () => {
    expect((await signoutPOST(app("POST", "/api/driver-app/signout"))).status).toBe(204);
    expect((await meGET(app("GET", "/api/driver-app/me"))).status).toBe(401);
    const st = (await (await statusGET(web("GET", "/api/drivers/app-status"))).json()) as { drivers: { driverId: string; state: string }[] };
    expect(st.drivers.find((d) => d.driverId === driverId)!.state).toBe("signed_out");
    // New link, new sign-in, then the company signs them out.
    const { invite } = (await (await invitePOST(web("POST", `/api/drivers/${driverId}/app-invite`, {}), params(driverId))).json()) as { invite: { url: string } };
    token = ((await (await redeemPOST(app("POST", "/api/driver-app/invite", { token: new URL(invite.url).searchParams.get("t") }, ""))).json()) as { token: string }).token;
    expect((await meGET(app("GET", "/api/driver-app/me"))).status).toBe(200);
    const pushed: PushMessage[] = [];
    setPushTransportForTests(async (m) => (pushed.push(...m), m.map(() => ({ ok: true }))));
    await pushPUT(app("PUT", "/api/driver-app/push", { token: "ExponentPushToken[zzz999yyy888]" }));
    const out = await companySignoutPOST(web("POST", `/api/drivers/${driverId}/app-signout`), params(driverId));
    expect(pushed.map((p) => p.data.type)).toEqual(["driver_signed_out"]);
    setPushTransportForTests(null);
    expect(((await out.json()) as { signedOut: number }).signedOut).toBe(1);
    expect((await reportPOST(app("POST", "/api/driver-app/report", { points: [] }))).status).toBe(401);
  });
});

describe("phone sign-in without texts", () => {
  it("emails the code to the driver's address and signs in with it", async () => {
    const db = getDb();
    const [d] = await db.insert(schema.drivers).values({ organizationId: orgId, name: "Mail Driver", phone: "+14165557177", email: "mail.driver@phone.test" }).returning();
    await db.execute(sql`truncate phone_codes`);
    const mails: EmailMessage[] = [];
    setEmailTransportForTests(async (m) => {
      mails.push(m);
    });
    try {
      const start = await phoneStartPOST(app("POST", "/api/driver-app/phone/start", { phone: "(416) 555-7177" }, ""));
      expect(start.status).toBe(202);
      const sent = (await start.json()) as { sentTo: string | null; channel: string | null };
      expect(sent.channel).toBe("email");
      expect(sent.sentTo).toMatch(/@phone\.test$/);
      expect(mails).toHaveLength(1);
      const code = /\b(\d{6})\b/.exec(`${mails[0]!.subject} ${mails[0]!.text ?? ""} ${mails[0]!.html ?? ""}`)?.[1];
      expect(code).toBeTruthy();
      const ok = await phoneVerifyPOST(app("POST", "/api/driver-app/phone/verify", { phone: "(416) 555-7177", code, device: { platform: "ios" } }, ""));
      expect(ok.status).toBe(201);
      const s = (await ok.json()) as { token: string; driver: { id: string } };
      expect(s.driver.id).toBe(d!.id);
      // a new number can't sign up until texts work (test numbers aside); nothing is sent
      expect((await phoneStartPOST(app("POST", "/api/driver-app/phone/start", { phone: "(416) 555-7999" }, ""))).status).toBe(400);
      expect(mails).toHaveLength(1);
      // a driver with no email gets told to ask the company
      await db.insert(schema.drivers).values({ organizationId: orgId, name: "No Mail", phone: "+14165557178" });
      expect((await phoneStartPOST(app("POST", "/api/driver-app/phone/start", { phone: "(416) 555-7178" }, ""))).status).toBe(400);
    } finally {
      setEmailTransportForTests(null);
    }
  });
});
