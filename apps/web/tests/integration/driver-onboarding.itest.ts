import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers";
import { createDriver, deleteDriver, updateDriver } from "@/lib/drivers";
import { listPlans } from "@/lib/plans";
import { setPlatformSettings, DEFAULT_PLATFORM_SETTINGS } from "@/lib/platform-settings";
import { POST as startPOST } from "@/app/api/driver-app/phone/start/route";
import { POST as verifyPOST } from "@/app/api/driver-app/phone/verify/route";
import { GET as meGET } from "@/app/api/driver-app/me/route";
import { GET as requestsGET } from "@/app/api/driver-app/requests/route";
import { POST as respondPOST } from "@/app/api/driver-app/requests/[id]/route";

const BASE = "http://localhost:3000";
const meta = { ipAddress: null, userAgent: null };
let ip = 1;
let rootId = "";
let orgA = "";
const post = (path: string, body: unknown, bearer = "") =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip++}`, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
const get = (path: string, bearer: string) => new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${bearer}` } });
const ctx = (organizationId: string) => ({ userId: rootId, organizationId, role: "ORG_ADMIN" as const, isSuperAdmin: true });

async function signUp(phone: string, name?: string) {
  const s = await startPOST(post("/api/driver-app/phone/start", { phone }));
  const start = (await s.json()) as { channel: string; newDriver: boolean; testCode?: string; error?: { message: string } };
  if (s.status !== 202) return { start, status: s.status, token: "" };
  const v = await verifyPOST(post("/api/driver-app/phone/verify", { phone, code: start.testCode, name, device: { platform: "ios" } }));
  const body = (await v.json()) as { token: string; created: boolean };
  return { start, status: v.status, token: body.token, created: body.created };
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, phone_codes restart identity cascade`);
  const plans = Object.fromEntries((await listPlans()).map((p) => [p.name, p.id]));
  const [root] = await db.insert(schema.users).values({ email: "root@onb.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  rootId = root!.id;
  orgA = (await createCustomer(rootId, { name: "Alpha Haul", slug: "alpha-haul", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free Basic"], admin: { email: "a@onb.test", name: "A" } }, meta)).organizationId;
});
afterAll(async () => {
  await closeDb();
});

describe("driver onboarding", () => {
  it("anyone joins with a test number: code comes back to the app, the name makes the account, no company needed", async () => {
    const r = await signUp("+14165550177", "Omar Haddad");
    expect(r.start).toMatchObject({ channel: "test", newDriver: true });
    expect(r.start.testCode).toMatch(/^\d{6}$/);
    expect(r.status).toBe(201);
    expect(r.created).toBe(true);
    const me = (await (await meGET(get("/api/driver-app/me", r.token))).json()) as { driver: { name: string }; company: { name: string }; link: string };
    expect(me).toMatchObject({ driver: { name: "Omar Haddad" }, company: { name: "RIO GPS" }, link: "self" });
    // Signing in again is the same account.
    const again = await signUp("+14165550177");
    expect(again.start.newDriver).toBe(false);
    expect(again.created).toBe(false);
  });

  it("a new number needs a name; a real number can't sign up until texts work; the test list works", async () => {
    const s = await startPOST(post("/api/driver-app/phone/start", { phone: "+14165550178" }));
    const { testCode } = (await s.json()) as { testCode: string };
    expect((await verifyPOST(post("/api/driver-app/phone/verify", { phone: "+14165550178", code: testCode }))).status).toBe(400);
    expect((await signUp("+16475551234")).status).toBe(400);
    await setPlatformSettings(rootId, { ...DEFAULT_PLATFORM_SETTINGS, driverTestNumbers: "+1 (647) 555-1234" }, meta);
    expect((await signUp("+16475551234", "Owner Test")).created).toBe(true);
    await setPlatformSettings(rootId, DEFAULT_PLATFORM_SETTINGS, meta);
  });

  it("a company adds the number: the request shows, accept; removing or deactivating keeps the driver's account", async () => {
    const d = await createDriver(ctx(orgA), { name: "Omar H", phone: "+14165550177" } as never, meta);
    const r = await signUp("+14165550177");
    const reqs = (await (await requestsGET(get("/api/driver-app/requests", r.token))).json()) as { requests: { id: string }[] };
    expect(reqs.requests.map((x) => x.id)).toEqual([d.id]);
    expect((await respondPOST(post(`/api/driver-app/requests/${d.id}`, { accept: true }, r.token), { params: Promise.resolve({ id: d.id }) })).status).toBe(200);
    // Signed in again: the company account comes first now.
    const r2 = await signUp("+14165550177");
    expect(((await (await meGET(get("/api/driver-app/me", r2.token))).json()) as { company: { name: string } }).company.name).toBe("Alpha Haul");
    // The company makes the driver inactive: the phone stays signed in, on the driver's own account.
    await updateDriver(ctx(orgA), d.id, { status: "inactive" }, meta);
    const me = (await (await meGET(get("/api/driver-app/me", r2.token))).json()) as { company: { name: string }; link: string };
    expect(me).toMatchObject({ company: { name: "RIO GPS" }, link: "self" });
    // Removed entirely: same.
    await updateDriver(ctx(orgA), d.id, { status: "active" }, meta);
    await getDb().update(schema.drivers).set({ appLink: "active" }).where(eq(schema.drivers.id, d.id));
    const r3 = await signUp("+14165550177");
    await deleteDriver(ctx(orgA), d.id, meta);
    expect((await meGET(get("/api/driver-app/me", r3.token))).status).toBe(200);
  });
});
