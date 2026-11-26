import { isLoadEnded, isLoadTracking } from "@rio-gps/core/loads";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { DriverAuth } from "./driver-app";
import { issueDriverInvite } from "./driver-app";
import { getServerEnv } from "./env";
import { NotFoundError, UnauthenticatedError as UnauthorizedError, ValidationError } from "./errors";
import { raiseLoadAlerts } from "./load-tracking";
import { logger } from "./logger";
import { recordBillableLoad } from "./plans";
import { sendPushMessages } from "./push";

/**
 * Loads sent to a driver's phone (driver-first, no browser link).
 *
 * - A load from a company the driver works for (accepted) needs no answer: it is the driver's own
 *   company, so it starts tracking when the app picks it up.
 * - A load from anyone else (a broker) is a load request: the driver accepts or declines in the
 *   app. After accepting, that company sees this load only, from the app, until it ends.
 * - A driver with no company yet gets a hidden home row (organization "rio-gps-drivers", link
 *   "self") so they can sign in to the app; that row never shares location with anyone.
 */

export const DRIVERS_ORG_SLUG = "rio-gps-drivers";
const origin = () => new URL(getServerEnv().AUTH_URL).origin;

let driversOrgCache: string | null = null;
/** The hidden organization that holds independent drivers (created on first use). */
export async function driversOrgId(): Promise<string> {
  if (driversOrgCache) return driversOrgCache;
  const db = getDb();
  await db.insert(schema.organizations).values({ name: "RIO GPS drivers", slug: DRIVERS_ORG_SLUG, status: "active", platformNotes: "Hidden: home of independent drivers in the driver app. Not a customer." }).onConflictDoNothing();
  const [o] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, DRIVERS_ORG_SLUG));
  driversOrgCache = o!.id;
  return o!.id;
}
export function _resetDriversOrgCacheForTests() {
  driversOrgCache = null;
}

/**
 * Before a load goes to a phone number: how the driver gets it.
 * - Has the app open somewhere: a notification (and the request waits in the app).
 * - Works for a company already: the generic app page (they sign in with their number).
 * - Nobody yet: a personal one-tap sign-in link (works before texts do).
 */
export async function appAccessForPhone(phone: string, name: string | null, actorUserId: string | null): Promise<{ link: string; hasApp: boolean }> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.drivers.id, appLink: schema.drivers.appLink, organizationId: schema.drivers.organizationId })
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .where(and(eq(schema.drivers.phone, phone), eq(schema.drivers.status, "active"), eq(schema.organizations.status, "active")));
  const [open] = rows.length
    ? await db
        .select({ id: schema.driverAppSessions.id })
        .from(schema.driverAppSessions)
        .where(and(inArray(schema.driverAppSessions.driverId, rows.map((r) => r.id)), isNull(schema.driverAppSessions.revokedAt)))
        .limit(1)
    : [];
  const hasApp = Boolean(open);
  if (hasApp || rows.some((r) => r.appLink === "active")) return { link: `${origin()}/driver-app`, hasApp };
  // Sign-in for this number: the company's own row if the driver is theirs, otherwise a hidden home row.
  let home = rows.find((r) => r.appLink === "self");
  if (!home) {
    const orgId = await driversOrgId();
    const [row] = await db.insert(schema.drivers).values({ organizationId: orgId, name: name?.trim() || "Driver", phone, appLink: "self", appLinkAt: new Date() }).returning({ id: schema.drivers.id, appLink: schema.drivers.appLink, organizationId: schema.drivers.organizationId });
    home = row!;
  }
  const inv = await issueDriverInvite(home.organizationId, home.id, actorUserId);
  return { link: inv.url, hasApp };
}

/** A notification to every phone signed in with this number. Best effort. */
export async function notifyDriverPhone(phone: string, title: string, body: string, data: Record<string, string | number>): Promise<number> {
  try {
    const rows = await getDb()
      .select({ token: schema.driverAppSessions.pushToken })
      .from(schema.driverAppSessions)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverAppSessions.driverId))
      .where(and(eq(schema.drivers.phone, phone), isNull(schema.driverAppSessions.revokedAt), isNotNull(schema.driverAppSessions.pushToken)));
    const tokens = [...new Set(rows.map((r) => r.token!).filter(Boolean))];
    if (!tokens.length) return 0;
    return (await sendPushMessages(tokens.map((to) => ({ to, title, body, data, sound: "default" as const, channelId: "alerts" })))).sent;
  } catch (err) {
    logger.error("driver_loads.notify_failed", {}, err);
    return 0;
  }
}

// ---------- driver side ----------

async function me(auth: DriverAuth) {
  const [d] = await getDb().select({ id: schema.drivers.id, phone: schema.drivers.phone, appLink: schema.drivers.appLink, organizationId: schema.drivers.organizationId }).from(schema.drivers).where(eq(schema.drivers.id, auth.driverId));
  if (!d) throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  return d;
}

/** Companies the driver works for (accepted): their loads need no answer. */
export async function ownOrgIds(phone: string | null, driverId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ organizationId: schema.drivers.organizationId })
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .where(and(phone ? eq(schema.drivers.phone, phone) : eq(schema.drivers.id, driverId), eq(schema.drivers.status, "active"), eq(schema.organizations.status, "active"), eq(schema.drivers.appLink, "active")));
  return [...new Set(rows.map((r) => r.organizationId))];
}

export interface LoadRequestDto {
  id: string;
  reference: string;
  from: { id: string; name: string; phone: string | null };
  pickup: { name: string | null; address: string; appointmentAt: string | null };
  delivery: { name: string | null; address: string; appointmentAt: string | null };
  notes: string | null;
  askedAt: string;
}

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

/** Loads sent to the driver's number by companies they don't work for, waiting for an answer. */
export async function driverLoadRequests(auth: DriverAuth): Promise<LoadRequestDto[]> {
  const d = await me(auth);
  if (!d.phone) return [];
  const own = await ownOrgIds(d.phone, d.id);
  const rows = await getDb().execute<{ id: string; reference: string; org_id: string; org_name: string; org_phone: string | null; pickup_name: string | null; pickup_address: string; pickup_appointment_at: Date | null; delivery_name: string | null; delivery_address: string; delivery_appointment_at: Date | null; notes: string | null; asked: Date }>(sql`
    select l.id, l.reference, o.id as org_id, o.name as org_name, o.contact_phone as org_phone, l.pickup_name, l.pickup_address, l.pickup_appointment_at,
           l.delivery_name, l.delivery_address, l.delivery_appointment_at, l.notes, coalesce(l.invite_sent_at, l.created_at) as asked
    from loads l join organizations o on o.id = l.organization_id and o.status = 'active'
    where l.tracking_mode = 'phone' and l.driver_phone = ${d.phone} and l.accepted_at is null and l.status not in ('delivered', 'cancelled', 'declined')
      ${own.length ? sql`and l.organization_id not in (${sql.join(own.map((o) => sql`${o}`), sql`, `)})` : sql``}
    order by coalesce(l.pickup_appointment_at, l.created_at)
    limit 20`);
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    from: { id: r.org_id, name: r.org_name, phone: r.org_phone },
    pickup: { name: r.pickup_name, address: r.pickup_address, appointmentAt: iso(r.pickup_appointment_at) },
    delivery: { name: r.delivery_name, address: r.delivery_address, appointmentAt: iso(r.delivery_appointment_at) },
    notes: r.notes,
    askedAt: iso(r.asked)!
  }));
}

export const LoadAnswerSchema = z.object({ action: z.enum(["accept", "decline", "stop", "resume"]) });

/**
 * The driver answers a load sent to their number: accept (tracking starts, this company sees this
 * load), decline, stop sharing (paused; the company is alerted) or resume.
 */
export async function answerLoad(auth: DriverAuth, loadId: string, action: z.infer<typeof LoadAnswerSchema>["action"], now = new Date()): Promise<void> {
  const d = await me(auth);
  const db = getDb();
  const [l] = await db.select().from(schema.loads).where(and(eq(schema.loads.id, loadId), eq(schema.loads.trackingMode, "phone")));
  if (!l || !d.phone || l.driverPhone !== d.phone) throw new NotFoundError("That load isn't yours");
  if (isLoadEnded(l.status)) throw new ValidationError("This load has ended.");
  const event = (type: "accepted" | "declined" | "sharing_stopped" | "sharing_resumed") => db.insert(schema.loadEvents).values({ organizationId: l.organizationId, loadId: l.id, type, at: now, detail: { via: "app" } });
  if (action === "accept") {
    if (l.acceptedAt) return;
    await accept(l, now, "RIO GPS driver app");
    await notifyCarriers(d.phone, d.id, l);
  } else if (action === "decline") {
    if (l.acceptedAt) throw new ValidationError("You already accepted this load. Use Stop sharing instead.");
    await db.update(schema.loads).set({ status: "declined", endedAt: now, updatedAt: now }).where(eq(schema.loads.id, l.id));
    await event("declined");
  } else if (action === "stop") {
    if (!isLoadTracking(l.status) || l.sharingStoppedAt) return;
    await db.update(schema.loads).set({ sharingStoppedAt: now, updatedAt: now }).where(eq(schema.loads.id, l.id));
    await event("sharing_stopped");
    await raiseLoadAlerts(l, [{ type: "load_paused", at: now, latitude: l.lastLat, longitude: l.lastLon }]);
  } else {
    if (!l.sharingStoppedAt) return;
    await db.update(schema.loads).set({ sharingStoppedAt: null, updatedAt: now }).where(eq(schema.loads.id, l.id));
    await event("sharing_resumed");
  }
  await writeAudit({ action: `load.driver_${action}`, actorUserId: null, organizationId: l.organizationId, targetType: "load", targetId: l.id, metadata: { via: "app" }, ipAddress: null, userAgent: null });
}

async function accept(l: typeof schema.loads.$inferSelect, now: Date, agent: string) {
  const db = getDb();
  const [upd] = await db
    .update(schema.loads)
    .set({ status: sql`case when ${schema.loads.status} = 'invited' then 'tracking'::load_status else ${schema.loads.status} end`, acceptedAt: now, consentUserAgent: agent, sharingStoppedAt: null, updatedAt: now })
    .where(and(eq(schema.loads.id, l.id), isNull(schema.loads.acceptedAt)))
    .returning({ id: schema.loads.id });
  if (!upd) return;
  await db.insert(schema.loadEvents).values({ organizationId: l.organizationId, loadId: l.id, type: "accepted", at: now, detail: { via: "app" } });
  await recordBillableLoad(db, l, now);
}

/** The driver's own companies are told (not asked) when the driver takes a load from someone else. */
async function notifyCarriers(phone: string, driverId: string, l: typeof schema.loads.$inferSelect) {
  const own = await ownOrgIds(phone, driverId);
  const [broker] = await getDb().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, l.organizationId));
  for (const orgId of own.filter((o) => o !== l.organizationId)) {
    const [row] = await getDb().select({ id: schema.drivers.id, name: schema.drivers.name }).from(schema.drivers).where(and(eq(schema.drivers.organizationId, orgId), eq(schema.drivers.phone, phone)));
    await writeAudit({ action: "driver.accepted_outside_load", actorUserId: null, organizationId: orgId, targetType: "driver", targetId: row?.id ?? driverId, metadata: { from: broker?.name ?? null, reference: l.reference }, ipAddress: null, userAgent: null });
  }
}

/** Loads from the driver's own companies start without an answer (sent to the phone by the company itself). */
export async function startOwnLoads(phone: string, own: string[], now = new Date()): Promise<void> {
  if (!own.length) return;
  const db = getDb();
  const rows = await db.select().from(schema.loads).where(and(inArray(schema.loads.organizationId, own), eq(schema.loads.trackingMode, "phone"), eq(schema.loads.driverPhone, phone), isNull(schema.loads.acceptedAt), inArray(schema.loads.status, ["invited", "tracking", "at_pickup", "in_transit", "at_delivery"])));
  for (const l of rows) await accept(l, now, "RIO GPS driver app (own company)");
}

/** Phone loads this phone feeds now: accepted, tracking, not paused. */
export async function feedingLoadIds(phone: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.loads.id })
    .from(schema.loads)
    .innerJoin(schema.organizations, and(eq(schema.organizations.id, schema.loads.organizationId), eq(schema.organizations.status, "active")))
    .where(and(eq(schema.loads.trackingMode, "phone"), eq(schema.loads.driverPhone, phone), isNotNull(schema.loads.acceptedAt), isNull(schema.loads.sharingStoppedAt), inArray(schema.loads.status, ["tracking", "at_pickup", "in_transit", "at_delivery"])));
  return rows.map((r) => r.id);
}
