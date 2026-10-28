/**
 * Broker loads: pure rules for a load's automatic status and its arrival estimate.
 * No I/O here; the web app stores the result and records the events.
 *
 * A load moves forward only:
 *   invited → tracking → at_pickup → in_transit → at_delivery → delivered
 * cancelled and declined are end states set by people, never by positions.
 * Leaving the delivery location counts as delivered (the truck has unloaded and gone),
 * and the broker can also mark a load delivered by hand at any time.
 */
import { haversineMeters, type LonLat } from "./geo.js";

export const LOAD_STATUSES = ["invited", "tracking", "at_pickup", "in_transit", "at_delivery", "delivered", "cancelled", "declined"] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/** Statuses in which the load is finished and the driver's link no longer accepts positions. */
export const LOAD_END_STATUSES: readonly LoadStatus[] = ["delivered", "cancelled", "declined"];
/** Statuses in which the driver has accepted and positions are expected. */
export const LOAD_TRACKING_STATUSES: readonly LoadStatus[] = ["tracking", "at_pickup", "in_transit", "at_delivery"];

export const isLoadEnded = (s: LoadStatus) => LOAD_END_STATUSES.includes(s);
export const isLoadTracking = (s: LoadStatus) => LOAD_TRACKING_STATUSES.includes(s);

export const LOAD_EVENT_TYPES = [
  "created",
  "invite_sent",
  "accepted",
  "declined",
  "sharing_stopped",
  "sharing_resumed",
  "arrived_pickup",
  "departed_pickup",
  "arrived_delivery",
  "departed_delivery",
  "delivered",
  "cancelled",
  "updated"
] as const;
export type LoadEventType = (typeof LOAD_EVENT_TYPES)[number];

export const LOAD_RADIUS_MIN_M = 100;
export const LOAD_RADIUS_MAX_M = 5_000;
export const LOAD_RADIUS_DEFAULT_M = 500;

/** A position must be at least this accurate (meters) to change the status. */
export const STATUS_MAX_ACCURACY_M = 500;
/** Leaving needs to be this far beyond the radius, so GPS jitter at the edge does not flap. */
const EXIT_FACTOR = 1.2;

export interface LoadStop {
  latitude: number;
  longitude: number;
  radiusM: number;
}

export interface LoadPosition {
  latitude: number;
  longitude: number;
  /** Reported accuracy in meters; null when unknown (trackers), which is treated as precise. */
  accuracyM: number | null;
}

export interface StatusStep {
  status: LoadStatus;
  /** Events caused by this position, oldest first. Empty when nothing changed. */
  events: LoadEventType[];
}

const ll = (p: { latitude: number; longitude: number }): LonLat => [p.longitude, p.latitude];
export const distanceToStopM = (p: { latitude: number; longitude: number }, stop: LoadStop) => haversineMeters(ll(p), ll(stop));
const inside = (p: LoadPosition, stop: LoadStop) => distanceToStopM(p, stop) <= stop.radiusM;
const leftStop = (p: LoadPosition, stop: LoadStop) => distanceToStopM(p, stop) > stop.radiusM * EXIT_FACTOR;

/**
 * The status after one new position. Only moves forward; ignores imprecise positions.
 * A load that skips a stage (e.g. first seen already at delivery) records only what was seen.
 */
export function nextLoadStatus(current: LoadStatus, pos: LoadPosition, pickup: LoadStop, delivery: LoadStop): StatusStep {
  const none = { status: current, events: [] };
  if (!isLoadTracking(current)) return none;
  if (pos.accuracyM !== null && pos.accuracyM > STATUS_MAX_ACCURACY_M) return none;
  switch (current) {
    case "tracking":
      if (inside(pos, pickup)) return { status: "at_pickup", events: ["arrived_pickup"] };
      if (inside(pos, delivery)) return { status: "at_delivery", events: ["arrived_delivery"] };
      return none;
    case "at_pickup":
      if (inside(pos, delivery)) return { status: "at_delivery", events: ["departed_pickup", "arrived_delivery"] };
      if (leftStop(pos, pickup)) return { status: "in_transit", events: ["departed_pickup"] };
      return none;
    case "in_transit":
      return inside(pos, delivery) ? { status: "at_delivery", events: ["arrived_delivery"] } : none;
    case "at_delivery":
      return leftStop(pos, delivery) ? { status: "delivered", events: ["departed_delivery", "delivered"] } : none;
    default:
      return none;
  }
}

/** Straight-line distance is multiplied by this to approximate road distance. */
export const ROAD_FACTOR = 1.3;
/** Average truck speed for the estimate, including stops (km/h). */
export const ETA_AVERAGE_KPH = 80;
/** Arriving up to this many minutes after the appointment is still "on time". */
export const LATE_GRACE_MINUTES = 15;

export interface LoadEta {
  /** Which stop the estimate is for. */
  target: "pickup" | "delivery";
  /** Estimated road distance remaining, meters. */
  distanceM: number;
  eta: Date;
  /** Minutes after the appointment (negative = early); null without an appointment. */
  lateByMinutes: number | null;
  late: boolean;
}

/**
 * A simple arrival estimate from the last position: straight line × ROAD_FACTOR at
 * ETA_AVERAGE_KPH. Only meaningful while heading to a stop (tracking or in transit).
 */
export function estimateLoadEta(
  status: LoadStatus,
  from: { latitude: number; longitude: number },
  fromAt: Date,
  pickup: LoadStop & { appointmentAt: Date | null },
  delivery: LoadStop & { appointmentAt: Date | null }
): LoadEta | null {
  const target = status === "tracking" ? "pickup" : status === "in_transit" ? "delivery" : null;
  if (!target) return null;
  const stop = target === "pickup" ? pickup : delivery;
  const distanceM = Math.round(distanceToStopM(from, stop) * ROAD_FACTOR);
  const eta = new Date(fromAt.getTime() + (distanceM / 1000 / ETA_AVERAGE_KPH) * 3_600_000);
  const lateByMinutes = stop.appointmentAt ? Math.round((eta.getTime() - stop.appointmentAt.getTime()) / 60_000) : null;
  return { target, distanceM, eta, lateByMinutes, late: lateByMinutes !== null && lateByMinutes > LATE_GRACE_MINUTES };
}

/** No position for this long while tracking is shown as "no recent location". */
export const LOAD_STALE_MINUTES = 30;

export function isLoadPositionStale(lastPositionAt: Date | null, now: Date): boolean {
  return lastPositionAt === null || now.getTime() - lastPositionAt.getTime() > LOAD_STALE_MINUTES * 60_000;
}
