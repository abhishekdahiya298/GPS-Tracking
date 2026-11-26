import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers";
import { seedDemoData } from "@/lib/demo-data";
import { listPlans } from "@/lib/plans";

const meta = { ipAddress: null, userAgent: null };
let rootId = "";
let carrierId = "";

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const plans = Object.fromEntries((await listPlans()).map((p) => [p.name, p.id]));
  const [root] = await db.insert(schema.users).values({ email: "root@demo.test", name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  rootId = root!.id;
  carrierId = (await createCustomer(rootId, { name: "RIO GPS Demo", slug: "rio-demo", timeZone: "America/Toronto", unitSystem: "imperial", planId: plans["Free (internal & testing)"], admin: { email: "support+demo@riogps.com", name: "Demo Admin" } }, meta)).organizationId;
  await db.update(schema.organizations).set({ isDemo: true }).where(eq(schema.organizations.id, carrierId));
  for (const n of [101, 102, 103, 104, 105]) await db.insert(schema.vehicles).values({ organizationId: carrierId, name: `Truck ${n}`, type: "truck" });
});
afterAll(async () => {
  await closeDb();
});

describe("demo data", () => {
  it("fills the demo carrier and creates the demo broker, then runs again without duplicates", async () => {
    const first = await seedDemoData(rootId, meta);
    expect(first.broker.created).toBe(true);
    expect(first.drivers.every((d) => d.created)).toBe(true);
    expect(first.logins.map((l) => l.email)).toEqual(expect.arrayContaining(["support+demo@riogps.com", "support+dispatch@riogps.com", "support+fleet@riogps.com", "support+viewer@riogps.com", "support+broker@riogps.com", "support+broker-dispatch@riogps.com"]));
    const db = getDb();
    const drivers = await db.select({ name: schema.drivers.name, vehicleId: schema.drivers.vehicleId, appLink: schema.drivers.appLink }).from(schema.drivers).where(eq(schema.drivers.organizationId, carrierId));
    expect(drivers).toHaveLength(6);
    expect(drivers.filter((d) => d.vehicleId)).toHaveLength(5);
    expect(drivers.find((d) => d.name === "Lucas Martin")!.appLink).toBe("pending");
    const loads = await db.select({ reference: schema.loads.reference, status: schema.loads.status, mode: schema.loads.trackingMode, org: schema.loads.organizationId }).from(schema.loads);
    expect(loads.filter((l) => l.org === carrierId && l.mode === "vehicle").every((l) => l.status === "tracking")).toBe(true);
    expect(loads.filter((l) => l.org === first.broker.id).map((l) => l.status).sort()).toEqual(["cancelled", "invited", "invited", "invited"]);
    const [b] = await db.select({ isDemo: schema.organizations.isDemo }).from(schema.organizations).where(eq(schema.organizations.id, first.broker.id));
    expect(b!.isDemo).toBe(true);
    const shipper = await db.select({ id: schema.loads.id }).from(schema.loads).where(and(eq(schema.loads.organizationId, first.broker.id), sql`${schema.loads.shipperTokenHash} is not null`));
    expect(shipper).toHaveLength(1);

    const again = await seedDemoData(rootId, meta);
    expect(again.broker.created).toBe(false);
    expect(again.loads.every((l) => !l.created)).toBe(true);
    expect((await db.select().from(schema.loads)).length).toBe(loads.length);
    expect((await db.select().from(schema.drivers).where(eq(schema.drivers.organizationId, carrierId))).length).toBe(6);
  });
});
