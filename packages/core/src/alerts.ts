/**
 * Pure alert evaluation: given a rule, its previous per-device state and a new
 * position, decide which alert events fire and what the next state is.
 * Edge-triggered: an event fires on a transition, never on every point.
 */
export const ALERT_TYPES = ["geofence_enter", "geofence_exit", "speeding", "ignition_on", "ignition_off", "device_offline"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Speeding re-arms only after dropping this far below the limit. */
export const SPEED_HYSTERESIS_KPH = 5;

export interface AlertState {
  inside?: boolean;
  speeding?: boolean;
  ignition?: boolean | null;
  offline?: boolean;
  lastEmailAt?: string;
}

export interface PositionInput {
  speedKph: number | null;
  ignition: boolean | null;
  /** Only for geofence rules: is the point inside the rule's fence. */
  inside?: boolean;
}

export interface Evaluation {
  fire: boolean;
  details: Record<string, unknown>;
  next: AlertState;
}

export function evaluatePosition(type: AlertType, params: { speedKph?: number }, prev: AlertState, p: PositionInput): Evaluation {
  switch (type) {
    case "geofence_enter":
    case "geofence_exit": {
      if (p.inside === undefined) return { fire: false, details: {}, next: prev };
      const next = { ...prev, inside: p.inside };
      // First observation only initializes state (no alert storm when a rule is created).
      if (prev.inside === undefined) return { fire: false, details: {}, next };
      const fire = type === "geofence_enter" ? !prev.inside && p.inside : prev.inside && !p.inside;
      return { fire, details: {}, next };
    }
    case "speeding": {
      const limit = params.speedKph ?? Infinity;
      const v = p.speedKph ?? 0;
      if (!prev.speeding && v > limit) return { fire: true, details: { speedKph: v, limitKph: limit }, next: { ...prev, speeding: true } };
      if (prev.speeding && v < limit - SPEED_HYSTERESIS_KPH) return { fire: false, details: {}, next: { ...prev, speeding: false } };
      return { fire: false, details: {}, next: prev };
    }
    case "ignition_on":
    case "ignition_off": {
      if (p.ignition === null) return { fire: false, details: {}, next: prev };
      const next = { ...prev, ignition: p.ignition };
      if (prev.ignition === undefined || prev.ignition === null) return { fire: false, details: {}, next };
      const fire = type === "ignition_on" ? !prev.ignition && p.ignition : prev.ignition && !p.ignition;
      return { fire, details: {}, next };
    }
    case "device_offline":
      // Any received position means the device is online again: re-arm.
      return { fire: false, details: {}, next: prev.offline ? { ...prev, offline: false } : prev };
  }
}

/** Offline check (scheduler): fires once when last_seen is older than the rule's threshold. */
export function evaluateOffline(prev: AlertState, lastSeenAt: Date | null, now: Date, offlineMinutes: number): Evaluation {
  const isOffline = !lastSeenAt || now.getTime() - lastSeenAt.getTime() > offlineMinutes * 60_000;
  if (isOffline && !prev.offline) {
    return { fire: true, details: { lastSeenAt: lastSeenAt?.toISOString() ?? null, offlineMinutes }, next: { ...prev, offline: true } };
  }
  if (!isOffline && prev.offline) return { fire: false, details: {}, next: { ...prev, offline: false } };
  return { fire: false, details: {}, next: prev };
}
