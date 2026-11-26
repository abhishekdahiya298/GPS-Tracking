import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { writeAudit } from "./audit";
import { createGeofence, createRule } from "./alerts";
import { createCustomer } from "./customers";
import { createDriver, DriverInputSchema } from "./drivers";
import { createLoad, createShipperLink, LoadInputSchema, setLoadOutcome } from "./loads";
import { addMember } from "./team";
import { NotFoundError } from "./errors";

/**
 * Demo and test data for the two demo customers (platform admin only, safe to run again):
 *
 * - RIO GPS Demo (carrier, slug rio-demo; its trucks are driven by the demo simulator): team
 *   members, drivers on the trucks, zones and alert rules, and today's loads on the moving trucks
 *   (tracked by the trucks' own trackers, so they move and deliver by themselves).
 * - RIO Demo Brokerage (broker, slug rio-demo-broker): created when missing; team, and loads sent
 *   to the demo drivers' phones (waiting in the driver app), one with a customer tracking link.
 *
 * Nothing here invents positions: loads only move from the simulator's tracker data. Every login is
 * a support+…@riogps.com address (mail lands in the support inbox); each person sets their own
 * password from the invitation email. Phone numbers are in the fictional 555-01xx range.
 */

export const DEMO_CARRIER_SLUG = "rio-demo";
export const DEMO_BROKER_SLUG = "rio-demo-broker";
type Meta = { ipAddress: string | null; userAgent: string | null };

const TEAM_CARRIER = [
  { email: "support+dispatch@riogps.com", name: "Dana Brooks", role: "DISPATCHER" as const },
  { email: "support+fleet@riogps.com", name: "Frank Miller", role: "FLEET_MANAGER" as const },
  { email: "support+viewer@riogps.com", name: "Vera Chen", role: "VIEWER" as const }
];
const TEAM_BROKER = [{ email: "support+broker-dispatch@riogps.com", name: "Nina Park", role: "DISPATCHER" as const }];
const BROKER_ADMIN = { email: "support+broker@riogps.com", name: "Brian Shaw" };

const day = (offsetDays: number, hour: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hour + 5, 0, 0, 0); // hour in Toronto (EST)
  return d.toISOString();
};
const lic = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const DRIVERS = [
  { name: "Arjun Singh", phone: "+14165550131", email: "support+arjun@riogps.com", truck: "Truck 101", licenseNumber: "S4521-73218-90512", exp: 610 },
  { name: "Maria Lopez", phone: "+14165550132", email: "support+maria@riogps.com", truck: "Truck 102", licenseNumber: "L6204-11877-40723", exp: 420 },
  { name: "Dev Patel", phone: "+14165550133", email: "support+dev@riogps.com", truck: "Truck 103", licenseNumber: "P1093-55620-81130", exp: 300 },
  { name: "James Carter", phone: "+14165550134", email: "support+james@riogps.com", truck: "Truck 104", licenseNumber: "C2287-90431-60214", exp: 18 },
  { name: "Harpreet Kaur", phone: "+14165550135", email: "support+harpreet@riogps.com", truck: "Truck 105", licenseNumber: "K7741-20385-10927", exp: 900 },
  // Added by phone and still waiting to accept in the app (shows "Request pending").
  { name: "Lucas Martin", phone: "+14165550136", email: "support+lucas@riogps.com", truck: null, licenseNumber: "M3318-47702-55109", exp: 500, pending: true }
];

/** Stops on the simulator's routes (the trucks pass through these, so the loads complete). */
const PLACES = {
  brampton: { name: "Brampton Yard", address: "Brampton, ON", latitude: 43.7315, longitude: -79.7624 },
  buffalo: { name: "Buffalo Terminal", address: "Buffalo, NY", latitude: 42.8864, longitude: -78.8784 },
  cleveland: { name: "Cleveland DC", address: "Cleveland, OH", latitude: 41.4993, longitude: -81.6944 },
  mississauga: { name: "Mississauga Cross-dock", address: "Mississauga, ON", latitude: 43.589, longitude: -79.6441 },
  london: { name: "London Warehouse", address: "London, ON", latitude: 42.9849, longitude: -81.2453 },
  detroit: { name: "Detroit Plant", address: "Detroit, MI", latitude: 42.3314, longitude: -83.0458 },
  chicago: { name: "Chicago Rail Ramp", address: "Chicago, IL", latitude: 41.8781, longitude: -87.6298 },
  toronto: { name: "Acme Foods DC", address: "100 Front St W, Toronto, ON", latitude: 43.6453, longitude: -79.3806 },
  montreal: { name: "Port of Montreal", address: "2100 Av. Pierre-Dupuy, Montreal, QC", latitude: 45.5048, longitude: -73.5566 },
  pittsburgh: { name: "Steel City Supply", address: "Pittsburgh, PA", latitude: 40.4406, longitude: -79.9959 },
  ottawa: { name: "Capital Grocers", address: "Ottawa, ON", latitude: 45.4215, longitude: -75.6972 }
};
const stop = (p: (typeof PLACES)[keyof typeof PLACES], appointmentAt: string | null, radiusM = 1500) => ({ ...p, radiusM, appointmentAt });

export interface DemoSeedResult {
  carrier: { id: string; name: string };
  broker: { id: string; name: string; created: boolean };
  logins: { email: string; name: string; company: string; role: string; invited: boolean }[];
  drivers: { name: string; phone: string; email: string; truck: string | null; created: boolean }[];
  loads: { company: string; reference: string; created: boolean; note: string }[];
  zones: string[];
  rules: string[];
}

async function orgBySlug(slug: string) {
  const [o] = await getDb().select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.slug, slug));
  return o ?? null;
}

async function ensureMember(ctx: TenantContext, company: string, m: { email: string; name: string; role: "ORG_ADMIN" | "FLEET_MANAGER" | "DISPATCHER" | "VIEWER" }, meta: Meta, out: DemoSeedResult) {
  const db = getDb();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, m.email));
  if (u) {
    const [mem] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.userId, u.id), eq(schema.memberships.organizationId, ctx.organizationId)));
    if (mem) return void out.logins.push({ ...m, company, invited: false });
  }
  const r = await addMember(ctx, m, meta);
  out.logins.push({ ...m, company, invited: r.emailed });
}

export async function seedDemoData(actorUserId: string, meta: Meta): Promise<DemoSeedResult> {
  const db = getDb();
  const carrier = await orgBySlug(DEMO_CARRIER_SLUG);
  if (!carrier) throw new NotFoundError("The RIO GPS Demo customer (rio-demo) was not found");
  const ctxFor = (organizationId: string): TenantContext => ({ userId: actorUserId, organizationId, role: null, isSuperAdmin: true });
  const cctx = ctxFor(carrier.id);
  const out: DemoSeedResult = { carrier, broker: { id: "", name: "", created: false }, logins: [], drivers: [], loads: [], zones: [], rules: [] };

  // ---- carrier team ----
  const [admin] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, carrier.id), eq(schema.memberships.role, "ORG_ADMIN")))
    .limit(1);
  if (admin) out.logins.push({ email: admin.email, name: admin.name, company: carrier.name, role: "ORG_ADMIN", invited: false });
  for (const m of TEAM_CARRIER) await ensureMember(cctx, carrier.name, m, meta, out);

  // ---- drivers on the demo trucks ----
  const vehicles = await db.select({ id: schema.vehicles.id, name: schema.vehicles.name }).from(schema.vehicles).where(and(eq(schema.vehicles.organizationId, carrier.id), inArray(schema.vehicles.name, ["Truck 101", "Truck 102", "Truck 103", "Truck 104", "Truck 105"])));
  const truck = (name: string | null) => (name ? (vehicles.find((v) => v.name === name)?.id ?? null) : null);
  for (const d of DRIVERS) {
    const [existing] = await db.select({ id: schema.drivers.id }).from(schema.drivers).where(and(eq(schema.drivers.organizationId, carrier.id), eq(schema.drivers.phone, d.phone)));
    if (!existing) {
      const vehicleId = truck(d.truck);
      // A truck can have one driver: free it from anyone else first.
      if (vehicleId) await db.update(schema.drivers).set({ vehicleId: null, assignedAt: null }).where(and(eq(schema.drivers.organizationId, carrier.id), eq(schema.drivers.vehicleId, vehicleId)));
      const row = await createDriver(cctx, DriverInputSchema.parse({ name: d.name, phone: d.phone, email: d.email, licenseNumber: d.licenseNumber, licenseExpiresOn: lic(d.exp), vehicleId, notes: "Demo driver" }), meta);
      // Demo drivers already said yes to the company, except the one still waiting.
      if (!d.pending) await db.update(schema.drivers).set({ appLink: "active" }).where(eq(schema.drivers.id, row.id));
    }
    out.drivers.push({ name: d.name, phone: d.phone, email: d.email, truck: d.truck, created: !existing });
  }

  // ---- zones and alert rules ----
  const zones = [
    { name: "Brampton Yard", place: PLACES.brampton, radiusM: 800, color: "#1d4ed8" },
    { name: "Buffalo Terminal", place: PLACES.buffalo, radiusM: 1500, color: "#15803d" },
    { name: "Chicago Rail Ramp", place: PLACES.chicago, radiusM: 2000, color: "#b45309" }
  ];
  const yard: Record<string, string> = {};
  for (const z of zones) {
    const [g] = await db.select({ id: schema.geofences.id }).from(schema.geofences).where(and(eq(schema.geofences.organizationId, carrier.id), eq(schema.geofences.name, z.name)));
    yard[z.name] = g?.id ?? (await createGeofence(cctx, { kind: "circle", name: z.name, color: z.color, center: [z.place.longitude, z.place.latitude], radiusM: z.radiusM }, meta)).id;
    out.zones.push(z.name);
  }
  const rules = [
    { name: "Speeding over 105 km/h", type: "speeding" as const, speedKph: 105 },
    { name: "Arrived at Buffalo Terminal", type: "geofence_enter" as const, geofenceId: yard["Buffalo Terminal"] },
    { name: "Left Brampton Yard", type: "geofence_exit" as const, geofenceId: yard["Brampton Yard"] },
    { name: "Tracker offline 60 min", type: "device_offline" as const, offlineMinutes: 60 }
  ];
  for (const r of rules) {
    const [have] = await db.select({ id: schema.alertRules.id }).from(schema.alertRules).where(and(eq(schema.alertRules.organizationId, carrier.id), eq(schema.alertRules.name, r.name)));
    if (!have) await createRule(cctx, { notifyEmail: false, active: true, ...r }, meta);
    out.rules.push(r.name);
  }

  // ---- today's carrier loads on the moving trucks ----
  const tag = new Date().toISOString().slice(5, 10).replace("-", "");
  const carrierLoads = [
    { ref: `DEMO-${tag}-101`, truck: "Truck 101", driver: DRIVERS[0]!, from: PLACES.brampton, to: PLACES.buffalo, notes: "24 pallets dry goods. Dock 4." },
    { ref: `DEMO-${tag}-102`, truck: "Truck 102", driver: DRIVERS[1]!, from: PLACES.buffalo, to: PLACES.cleveland, notes: "Reefer, keep at 2 °C." },
    { ref: `DEMO-${tag}-103`, truck: "Truck 103", driver: DRIVERS[2]!, from: PLACES.mississauga, to: PLACES.london, notes: "Auto parts, 18 skids." },
    { ref: `DEMO-${tag}-104`, truck: "Truck 104", driver: DRIVERS[3]!, from: PLACES.detroit, to: PLACES.chicago, notes: "Containers to rail ramp." }
  ];
  for (const l of carrierLoads) {
    const vehicleId = truck(l.truck);
    if (!vehicleId) continue;
    const created = await ensureLoad(cctx, l.ref, () =>
      createLoad(cctx, LoadInputSchema.parse({ reference: l.ref, carrierName: carrier.name, driverName: l.driver.name, driverPhone: l.driver.phone, trackingMode: "vehicle", vehicleId, notes: l.notes, sendInvite: false, pickup: stop(l.from, day(0, 8)), delivery: stop(l.to, day(0, 17)) }), meta)
    );
    out.loads.push({ company: carrier.name, reference: l.ref, created, note: `${l.truck} tracker; moves with the simulator` });
  }
  {
    const ref = `DEMO-${tag}-201`;
    const created = await ensureLoad(cctx, ref, () =>
      createLoad(cctx, LoadInputSchema.parse({ reference: ref, carrierName: carrier.name, driverName: "Lucas Martin", driverPhone: "+14165550136", trackingMode: "phone", notes: "Phone-tracked load for the driver app.", sendInvite: false, pickup: stop(PLACES.toronto, day(1, 9), 500), delivery: stop(PLACES.ottawa, day(1, 15), 500) }), meta)
    );
    out.loads.push({ company: carrier.name, reference: ref, created, note: "Driver's phone; waits until Lucas accepts the company" });
  }

  // ---- broker ----
  let broker = await orgBySlug(DEMO_BROKER_SLUG);
  if (!broker) {
    const [plan] = await db.select({ id: schema.plans.id }).from(schema.plans).where(ilike(schema.plans.name, "free (internal & testing)"));
    const r = await createCustomer(actorUserId, { name: "RIO Demo Brokerage", slug: DEMO_BROKER_SLUG, timeZone: "America/Toronto", unitSystem: "imperial", planId: plan?.id, admin: BROKER_ADMIN }, meta);
    await db.update(schema.organizations).set({ isDemo: true, contactName: BROKER_ADMIN.name, contactEmail: BROKER_ADMIN.email, contactPhone: "+14165550199", platformNotes: "Demo broker for testing loads. Logins: support+broker@ / support+broker-dispatch@riogps.com." }).where(eq(schema.organizations.id, r.organizationId));
    broker = { id: r.organizationId, name: "RIO Demo Brokerage" };
    out.broker.created = true;
    out.logins.push({ ...BROKER_ADMIN, company: broker.name, role: "ORG_ADMIN", invited: r.admin.emailed });
  } else {
    out.logins.push({ ...BROKER_ADMIN, company: broker.name, role: "ORG_ADMIN", invited: false });
  }
  out.broker.id = broker.id;
  out.broker.name = broker.name;
  const bctx = ctxFor(broker.id);
  for (const m of TEAM_BROKER) await ensureMember(bctx, broker.name, m, meta, out);

  const brokerLoads = [
    { ref: `BRK-${tag}-01`, driver: DRIVERS[0]!, from: PLACES.toronto, to: PLACES.montreal, pick: day(1, 8), drop: day(1, 16), notes: "Rate $1,450. Lumper paid by shipper.", shipperLink: true },
    { ref: `BRK-${tag}-02`, driver: DRIVERS[1]!, from: PLACES.buffalo, to: PLACES.pittsburgh, pick: day(1, 10), drop: day(1, 15), notes: "Rate $980. Appointment required at delivery." },
    { ref: `BRK-${tag}-03`, driver: { name: "Omar Haddad", phone: "+14165550141" }, from: PLACES.mississauga, to: PLACES.ottawa, pick: day(2, 7), drop: day(2, 13), notes: "Independent driver (no company yet)." },
    { ref: `BRK-${tag}-04`, driver: DRIVERS[2]!, from: PLACES.london, to: PLACES.detroit, pick: day(0, 13), drop: day(0, 18), notes: "Cancelled by shipper.", cancel: true }
  ];
  for (const l of brokerLoads) {
    const created = await ensureLoad(bctx, l.ref, async () => {
      const r = await createLoad(bctx, LoadInputSchema.parse({ reference: l.ref, carrierName: "RIO GPS Demo", driverName: l.driver.name, driverPhone: l.driver.phone, trackingMode: "phone", notes: l.notes, sendInvite: false, pickup: stop(l.from, l.pick, 800), delivery: stop(l.to, l.drop, 800) }), meta);
      if (l.shipperLink) await createShipperLink(bctx, r.id, meta);
      if (l.cancel) await setLoadOutcome(bctx, r.id, "cancel", meta);
      return r;
    });
    out.loads.push({ company: broker.name, reference: l.ref, created, note: l.cancel ? "Cancelled" : `Sent to ${l.driver.name}'s phone; waiting for Accept in the app${l.shipperLink ? "; has a customer tracking link" : ""}` });
  }

  await writeAudit({ action: "platform.demo_data_seeded", actorUserId, organizationId: carrier.id, targetType: "organization", targetId: carrier.id, metadata: { broker: broker.id, loads: out.loads.filter((l) => l.created).length }, ...meta });
  return out;
}

async function ensureLoad(ctx: TenantContext, reference: string, make: () => Promise<unknown>): Promise<boolean> {
  const [l] = await getDb().select({ id: schema.loads.id }).from(schema.loads).where(and(eq(schema.loads.organizationId, ctx.organizationId), eq(schema.loads.reference, reference)));
  if (l) return false;
  await make();
  return true;
}
