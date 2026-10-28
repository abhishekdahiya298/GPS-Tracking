import type { UnitSystem } from "@rio-gps/core";
import { estimateLoadEta, isLoadEnded, isLoadTracking, nextLoadStatus, type LoadEventType, type LoadStatus } from "@rio-gps/core/loads";
import type { TimeFormat } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ValidationError } from "./errors";
import { hashLoadToken, LoadTokenSchema } from "./loads";
import { logger } from "./logger";

/**
 * The two public (no sign-in) sides of a load:
 *
 * DRIVER (/d#token): sees who is asking and for which load, accepts or declines, sends
 * positions while the page is open, and can stop sharing at any time. Positions are accepted
 * only between accepting and the load ending, and only while sharing is on.
 *
 * SHIPPER (/track#token): read-only status, ETA and last position. Never the driver's name or
 * phone, the carrier, notes, history or anything else of the broker's.
 *
 * Unknown, malformed and revoked tokens all get null (callers answer them identically).
 */
type Meta = { ipAddress: string | null; userAgent: string | null };

/** How often the driver page sends a position (seconds); returned to the client. */
export const DRIVER_PING_INTERVAL_SECONDS = 120;
/** Positions in one request (the page queues while offline and sends them together). */
const MAX_BATCH = 100;
const CLOCK_SLACK_MS = 2 * 60_000;

interface OrgDisplay {
  organizationName: string;
  unitSystem: UnitSystem;
  timeZone: string;
  timeFormat: TimeFormat;
}

const shortStop = (name: string | null, address: string) => ({ name, address });

async function rowByDriverToken(token: string) {
  if (!LoadTokenSchema.safeParse(token).success) return null;
  const [r] = await getDb()
    .select({ load: schema.loads, org: { name: schema.organizations.name, unitSystem: schema.organizations.unitSystem, timeZone: schema.organizations.timeZone, timeFormat: schema.organizations.timeFormat } })
    .from(schema.loads)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.loads.organizationId))
    .where(eq(schema.loads.driverTokenHash, hashLoadToken(token)));
  return r ?? null;
}

export interface DriverView extends OrgDisplay {
  reference: string;
  driverName: string | null;
  status: LoadStatus;
  /** invite: not answered yet; sharing: accepted and on; paused: accepted, driver stopped; ended. */
  phase: "invite" | "sharing" | "paused" | "ended";
  pickup: { name: string | null; address: string; appointmentAt: string | null };
  delivery: { name: string | null; address: string; appointmentAt: string | null };
  pingIntervalSeconds: number;
}

function driverPhase(l: typeof schema.loads.$inferSelect): DriverView["phase"] {
  if (isLoadEnded(l.status)) return "ended";
  if (l.status === "invited") return "invite";
  return l.sharingStoppedAt ? "paused" : "sharing";
}

export async function viewAsDriver(token: string): Promise<DriverView | null> {
  const r = await rowByDriverToken(token);
  if (!r) return null;
  const l = r.load;
  return {
    organizationName: r.org.name,
    unitSystem: r.org.unitSystem,
    timeZone: r.org.timeZone,
    timeFormat: r.org.timeFormat,
    reference: l.reference,
    driverName: l.driverName,
    status: l.status,
    phase: driverPhase(l),
    pickup: { ...shortStop(l.pickupName, l.pickupAddress), appointmentAt: l.pickupAppointmentAt?.toISOString() ?? null },
    delivery: { ...shortStop(l.deliveryName, l.deliveryAddress), appointmentAt: l.deliveryAppointmentAt?.toISOString() ?? null },
    pingIntervalSeconds: DRIVER_PING_INTERVAL_SECONDS
  };
}

export const DriverActionSchema = z.object({ token: z.string(), action: z.enum(["accept", "decline", "stop"]) });

/**
 * accept: consent (first time) or resume after a pause. decline: before accepting, ends the load
 * request. stop: pause sharing after accepting (the broker sees "driver stopped sharing").
 * Returns the new view, or null for a token that is not valid.
 */
export async function driverAction(token: string, action: "accept" | "decline" | "stop", meta: Meta, now = new Date()): Promise<DriverView | null> {
  const r = await rowByDriverToken(token);
  if (!r) return null;
  const l = r.load;
  const db = getDb();
  const event = (type: LoadEventType) => db.insert(schema.loadEvents).values({ organizationId: l.organizationId, loadId: l.id, type, at: now });
  if (isLoadEnded(l.status)) return viewAsDriver(token);

  if (action === "accept") {
    if (l.status === "invited") {
      await db.update(schema.loads).set({ status: "tracking", acceptedAt: now, consentUserAgent: meta.userAgent?.slice(0, 300) ?? null, sharingStoppedAt: null, updatedAt: now }).where(eq(schema.loads.id, l.id));
      await event("accepted");
    } else if (l.sharingStoppedAt) {
      await db.update(schema.loads).set({ sharingStoppedAt: null, updatedAt: now }).where(eq(schema.loads.id, l.id));
      await event("sharing_resumed");
    }
  } else if (action === "decline") {
    if (l.status !== "invited") throw new ValidationError("You already accepted this load. Use Stop sharing instead.");
    await db.update(schema.loads).set({ status: "declined", endedAt: now, updatedAt: now }).where(eq(schema.loads.id, l.id));
    await event("declined");
  } else if (isLoadTracking(l.status) && !l.sharingStoppedAt) {
    await db.update(schema.loads).set({ sharingStoppedAt: now, updatedAt: now }).where(eq(schema.loads.id, l.id));
    await event("sharing_stopped");
  }
  return viewAsDriver(token);
}

const PositionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  speedKph: z.number().min(0).max(400).nullish(),
  headingDeg: z.number().min(0).max(360).nullish(),
  /** When the phone took the fix (ISO). */
  recordedAt: z.string().datetime({ offset: true })
});
export const DriverPingSchema = z.object({ token: z.string(), positions: z.array(PositionSchema).min(1).max(MAX_BATCH), source: z.enum(["web", "app"]).default("web") });

export type PingResult = { accepted: number; phase: DriverView["phase"]; status: LoadStatus; pingIntervalSeconds: number };

/**
 * Stores positions and moves the status forward. Positions from before the driver accepted,
 * from more than 24 hours ago or from the future are dropped. Repeats are ignored.
 * The load row is locked for the update, so two requests cannot both advance the status.
 */
export async function recordDriverPositions(token: string, input: z.infer<typeof DriverPingSchema>, now = new Date()): Promise<PingResult | null> {
  if (!LoadTokenSchema.safeParse(token).success) return null;
  return getDb().transaction(async (tx) => {
    const [l] = await tx.select().from(schema.loads).where(eq(schema.loads.driverTokenHash, hashLoadToken(token))).for("update");
    if (!l) return null;
    const result = (accepted: number, status: LoadStatus, phase: DriverView["phase"]): PingResult => ({ accepted, status, phase, pingIntervalSeconds: DRIVER_PING_INTERVAL_SECONDS });
    if (!isLoadTracking(l.status) || l.sharingStoppedAt || !l.acceptedAt) return result(0, l.status, driverPhase(l));

    // Two minutes of slack either side for phones whose clock is a little off.
    const earliest = Math.max(l.acceptedAt.getTime() - CLOCK_SLACK_MS, now.getTime() - 24 * 3_600_000);
    const latest = now.getTime() + CLOCK_SLACK_MS;
    const positions = input.positions
      .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
      .filter((p) => p.at.getTime() >= earliest && p.at.getTime() <= latest)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    if (positions.length === 0) return result(0, l.status, "sharing");

    const inserted = await tx
      .insert(schema.loadPings)
      .values(
        positions.map((p) => ({
          organizationId: l.organizationId,
          loadId: l.id,
          recordedAt: p.at,
          receivedAt: now,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracyM: p.accuracyM ?? null,
          speedKph: p.speedKph ?? null,
          headingDeg: p.headingDeg ?? null,
          source: input.source
        }))
      )
      .onConflictDoNothing()
      .returning({ recordedAt: schema.loadPings.recordedAt });
    const fresh = new Set(inserted.map((i) => i.recordedAt.getTime()));

    // Only new positions newer than the last one move the status and the "last position".
    const lastAt = l.lastPositionAt?.getTime() ?? 0;
    let status = l.status;
    const events: { type: LoadEventType; at: Date; latitude: number; longitude: number }[] = [];
    const pickup = { latitude: l.pickupLat, longitude: l.pickupLon, radiusM: l.pickupRadiusM };
    const delivery = { latitude: l.deliveryLat, longitude: l.deliveryLon, radiusM: l.deliveryRadiusM };
    let newest: (typeof positions)[number] | null = null;
    for (const p of positions) {
      if (!fresh.has(p.at.getTime()) || p.at.getTime() <= lastAt) continue;
      newest = p;
      const step = nextLoadStatus(status, { latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracyM ?? null }, pickup, delivery);
      for (const type of step.events) events.push({ type, at: p.at, latitude: p.latitude, longitude: p.longitude });
      status = step.status;
      if (isLoadEnded(status)) break;
    }

    if (newest) {
      await tx
        .update(schema.loads)
        .set({
          status,
          lastLat: newest.latitude,
          lastLon: newest.longitude,
          lastAccuracyM: newest.accuracyM ?? null,
          lastSpeedKph: newest.speedKph ?? null,
          lastPositionAt: newest.at,
          ...(isLoadEnded(status) ? { endedAt: now } : {}),
          updatedAt: now
        })
        .where(eq(schema.loads.id, l.id));
    }
    if (events.length) {
      await tx.insert(schema.loadEvents).values(events.map((e) => ({ organizationId: l.organizationId, loadId: l.id, type: e.type, at: e.at, latitude: e.latitude, longitude: e.longitude, detail: { automatic: true } })));
      logger.info("load.status_changed", { loadId: l.id, from: l.status, to: status });
    }
    return result(inserted.length, status, isLoadEnded(status) ? "ended" : "sharing");
  });
}

export interface ShipperView extends OrgDisplay {
  reference: string;
  status: LoadStatus;
  pickup: { name: string | null; address: string; latitude: number; longitude: number; appointmentAt: string | null };
  delivery: { name: string | null; address: string; latitude: number; longitude: number; appointmentAt: string | null };
  /** null before the first position, after the load ended, or while the driver paused sharing. */
  position: { latitude: number; longitude: number; at: string } | null;
  eta: { target: "pickup" | "delivery"; at: string; late: boolean } | null;
  deliveredAt: string | null;
}

export async function viewAsShipper(token: string): Promise<ShipperView | null> {
  if (!LoadTokenSchema.safeParse(token).success) return null;
  const [r] = await getDb()
    .select({ load: schema.loads, org: { name: schema.organizations.name, unitSystem: schema.organizations.unitSystem, timeZone: schema.organizations.timeZone, timeFormat: schema.organizations.timeFormat } })
    .from(schema.loads)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.loads.organizationId))
    .where(eq(schema.loads.shipperTokenHash, hashLoadToken(token)));
  if (!r) return null;
  const l = r.load;
  const live = isLoadTracking(l.status) && !l.sharingStoppedAt && l.lastLat !== null && l.lastLon !== null && l.lastPositionAt !== null;
  const eta = live
    ? estimateLoadEta(
        l.status,
        { latitude: l.lastLat!, longitude: l.lastLon! },
        l.lastPositionAt!,
        { latitude: l.pickupLat, longitude: l.pickupLon, radiusM: l.pickupRadiusM, appointmentAt: l.pickupAppointmentAt },
        { latitude: l.deliveryLat, longitude: l.deliveryLon, radiusM: l.deliveryRadiusM, appointmentAt: l.deliveryAppointmentAt }
      )
    : null;
  return {
    organizationName: r.org.name,
    unitSystem: r.org.unitSystem,
    timeZone: r.org.timeZone,
    timeFormat: r.org.timeFormat,
    reference: l.reference,
    status: l.status,
    pickup: { name: l.pickupName, address: l.pickupAddress, latitude: l.pickupLat, longitude: l.pickupLon, appointmentAt: l.pickupAppointmentAt?.toISOString() ?? null },
    delivery: { name: l.deliveryName, address: l.deliveryAddress, latitude: l.deliveryLat, longitude: l.deliveryLon, appointmentAt: l.deliveryAppointmentAt?.toISOString() ?? null },
    position: live ? { latitude: l.lastLat!, longitude: l.lastLon!, at: l.lastPositionAt!.toISOString() } : null,
    eta: eta ? { target: eta.target, at: eta.eta.toISOString(), late: eta.late } : null,
    deliveredAt: l.status === "delivered" ? (l.endedAt?.toISOString() ?? null) : null
  };
}
