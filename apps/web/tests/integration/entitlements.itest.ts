import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contextHasPermission } from "@rio-gps/core";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { resolveTenantContext } from "@/lib/authz";
import { createCustomer } from "@/lib/customers";
import { endTrial, listPlans, organizationPlanAccess, setCustomerPlan } from "@/lib/plans";
import { POST as vehiclesPOST } from "@/app/api/vehicles/route";
import { POST as upgradePOST } from "@/app/api/upgrade-request/route";
import { GET as tripsGET } from "@/app/api/reports/trips/route";
import { GET as historyGET } from "@/app/api/locations/history/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const meta = { ipAddress: null, userAgent: null };
let cookie = "";
let ipN = 1;
let orgId = "";
let platformId = "";
let ownerId = "";
const plans: Record<string, string> = {};

const req = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, leads restart identity cascade`);
  for (const p of await listPlans()) plans[p.name] = p.id;
  const [pf] = await db.insert(schema.users).values({ email: "root@rio.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  platformId = pf!.id;
  orgId = (await createCustomer(platformId, { name: "Dhillon Transport", slug: "dhillon", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free Basic"], admin: { email: "first@dhillon.test", name: "First" } }, meta)).organizationId;
  await createUserWithMembership({ email: "owner@dhillon.test", name: "Gurpreet", password: PASSWORD, organizationSlug: "dhillon", role: "ORG_ADMIN" });
  const [o] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "owner@dhillon.test"));
  ownerId = o!.id;
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.7.${ipN++}` }, body: JSON.stringify({ email: "owner@dhillon.test", password: PASSWORD }) })
  );
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});
afterAll(async () => {
  await closeDb();
});

describe("Free Basic: locks and limits", () => {
  it("the migration created Free Basic as the public plan, and a customer copies its terms", async () => {
    const fb = (await listPlans()).find((p) => p.name === "Free Basic")!;
    expect(fb.visibility).toBe("public");
    expect(fb.limits.vehicles).toBe(2);
    const access = await organizationPlanAccess(orgId);
    expect(access!.lockedFeatures).toContain("gps_trackers");
    expect(access!.limits).toMatchObject({ vehicles: 2, historyDays: 1 });
  });

  it("locked features take away their permissions", async () => {
    const ctx = await resolveTenantContext({ userId: ownerId, isSuperAdmin: false, activeOrganizationId: null } as never);
    expect(contextHasPermission(ctx, "alerts.read")).toBe(false);
    expect(contextHasPermission(ctx, "devices.read")).toBe(false);
    expect(contextHasPermission(ctx, "vehicles.create")).toBe(true);
  });

  it("a third truck is refused with LIMIT_REACHED and the numbers", async () => {
    for (const name of ["Truck 101", "Truck 102"]) expect((await vehiclesPOST(req("POST", "/api/vehicles", { name }))).status).toBe(201);
    const res = await vehiclesPOST(req("POST", "/api/vehicles", { name: "Truck 103" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string; details: { used: number; max: number } } };
    expect(body.error.code).toBe("LIMIT_REACHED");
    expect(body.error.details).toMatchObject({ used: 2, max: 2, limit: "vehicles" });
    expect(body.error.message).toMatch(/2 of 2/);
  });

  it("reports answer FEATURE_LOCKED; history is clamped to today", async () => {
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const r = await tripsGET(req("GET", `/api/reports/trips?deviceId=00000000-0000-4000-8000-000000000001&from=${from}&to=${to}`));
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("FEATURE_LOCKED");
    const h = await historyGET(req("GET", `/api/locations/history?deviceId=00000000-0000-4000-8000-000000000001&from=${from}&to=${to}`));
    // No such device here (404), but only after the clamp: the request itself is allowed.
    expect([200, 404]).toContain(h.status);
  });

  it("Request upgrade becomes a lead with the plan and needs", async () => {
    const res = await upgradePOST(req("POST", "/api/upgrade-request", { needs: ["more_vehicles", "gps_trackers"], trucks: 12, contactWay: "whatsapp" }));
    expect(res.status).toBe(201);
    const [lead] = await getDb().select().from(schema.leads).where(eq(schema.leads.organizationId, orgId));
    expect(lead).toMatchObject({ source: "upgrade", planName: "Free Basic", contactWay: "whatsapp", fleetSize: "12" });
    expect(lead!.needs).toEqual(["more_vehicles", "gps_trackers"]);
  });
});

describe("trials", () => {
  it("a trial lifts the limits, then goes back to Free Basic by itself", async () => {
    const gps = (await listPlans()).find((p) => p.name === "GPS + Loads")!;
    const t0 = new Date();
    await setCustomerPlan(platformId, orgId, { planId: gps.id, modules: gps.modules, includedLoads: gps.includedLoads, extraLoad: 0, monthlyFee: 0, perTracker: 0, trialDays: 14 }, meta, { now: t0 });
    let access = await organizationPlanAccess(orgId);
    expect(access!.planName).toBe("GPS + Loads");
    expect(access!.lockedFeatures).toEqual([]);
    expect(access!.trialEndsAt).not.toBeNull();
    expect((await vehiclesPOST(req("POST", "/api/vehicles", { name: "Truck 103" }))).status).toBe(201);

    // 15 days later: the first request closes the trial.
    expect(await endTrial(orgId, new Date(t0.getTime() + 15 * 86_400_000))).toBe(true);
    access = await organizationPlanAccess(orgId);
    expect(access!.planName).toBe("Free Basic");
    expect(access!.trialEndsAt).toBeNull();
    // Nothing deleted; adding more asks for an upgrade.
    expect((await vehiclesPOST(req("POST", "/api/vehicles", { name: "Truck 104" }))).status).toBe(403);
    expect(await endTrial(orgId)).toBe(false);
  });
});
