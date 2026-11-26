import { isOrganizationActive } from "./organization-status";
import type { UnitSystem } from "@rio-gps/core";
import { estimateLoadEta, isLoadTracking, type LoadStatus } from "@rio-gps/core/loads";
import type { TimeFormat } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { hashLoadToken, LoadTokenSchema } from "./loads";
import { alertsForEvents, applyLoadPositions, raiseLoadAlerts, type AppliedPositions } from "./load-tracking";

/**
 * The two public (no sign-in) sides of a load:
 *
 * DRIVER: no browser page any more (driver-first). Loads go to the RIO GPS driver app; the
 * app's positions for an accepted load come in through recordAppLoadPositions. Positions are
 * accepted only between accepting and the load ending, and only while sharing is on.
 *
 * SHIPPER (/track#token): read-only status, ETA and last position. Never the driver's name or
 * phone, the carrier, notes, history or anything else of the broker's.
 *
 * Unknown, malformed and revoked tokens all get null (callers answer them identically).
 */

/** Positions applied to a load from one app report. */
const MAX_BATCH = 100;
const CLOCK_SLACK_MS = 2 * 60_000;

interface OrgDisplay {
  organizationName: string;
  unitSystem: UnitSystem;
  timeZone: string;
  timeFormat: TimeFormat;
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
type PingInput = { positions: z.infer<typeof PositionSchema>[]; source: "web" | "app" };

export type PingResult = { accepted: number; status: LoadStatus };

/**
 * Stores positions from the driver app for a load the driver accepted and moves the status forward.
 * Positions from before acceptance, from more than 24 hours ago or from the future are dropped.
 * Repeats are ignored. The load row is locked, so two requests cannot both advance the status.
 */
export async function recordAppLoadPositions(loadId: string, positions: z.infer<typeof PositionSchema>[], now = new Date()): Promise<PingResult | null> {
  if (!positions.length) return null;
  return recordPhoneLoadPositions(eq(schema.loads.id, loadId), { positions: positions.slice(-MAX_BATCH), source: "app" }, now);
}

async function recordPhoneLoadPositions(match: SQL, input: PingInput, now: Date): Promise<PingResult | null> {
  let alertsAfter: { load: typeof schema.loads.$inferSelect; events: AppliedPositions["events"] } | null = null;
  const out = await getDb().transaction(async (tx) => {
    const [l] = await tx
      .select()
      .from(schema.loads)
      .where(and(match, eq(schema.loads.trackingMode, "phone")))
      .for("update");
    // Suspended or archived customer: the link answers like an unknown one.
    if (!l || !(await isOrganizationActive(l.organizationId))) return null;
    const result = (accepted: number, status: LoadStatus): PingResult => ({ accepted, status });
    if (!isLoadTracking(l.status) || l.sharingStoppedAt || !l.acceptedAt) return result(0, l.status);

    // Two minutes of slack either side for phones whose clock is a little off.
    const earliest = Math.max(l.acceptedAt.getTime() - CLOCK_SLACK_MS, now.getTime() - 24 * 3_600_000);
    const latest = now.getTime() + CLOCK_SLACK_MS;
    const positions = input.positions
      .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
      .filter((p) => p.at.getTime() >= earliest && p.at.getTime() <= latest)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    if (positions.length === 0) return result(0, l.status);

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

    // Only new positions (not repeats) move the status and the "last position".
    const applied = await applyLoadPositions(
      tx,
      l,
      positions.filter((p) => fresh.has(p.at.getTime())).map((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracyM ?? null, speedKph: p.speedKph ?? null, at: p.at })),
      now
    );
    const status = applied.status;
    alertsAfter = { load: l, events: applied.events };
    return result(inserted.length, status);
  });
  // After commit: arrivals and automatic delivery become alerts.
  const after = alertsAfter as { load: typeof schema.loads.$inferSelect; events: AppliedPositions["events"] } | null;
  if (after) await raiseLoadAlerts(after.load, alertsForEvents(after.events));
  return out;
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
    .innerJoin(schema.organizations, and(eq(schema.organizations.id, schema.loads.organizationId), eq(schema.organizations.status, "active")))
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
