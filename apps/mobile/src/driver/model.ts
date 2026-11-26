/**
 * Driver mode, plain TypeScript (unit-tested): what the phone sends and how it is shown.
 * Location is shared all the time while the driver is signed in. There is no duty switch.
 */

export type Permission = "always" | "while_using" | "off";

export interface ReportPoint {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  accuracyM: number | null;
  recordedAt: string;
}

/** What the phone allows: background ("Always") is what keeps the map up to date. */
export function permissionFrom(foreground: boolean, background: boolean): Permission {
  if (background) return "always";
  return foreground ? "while_using" : "off";
}

interface PhoneLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number; speed: number | null; heading: number | null; altitude: number | null; accuracy: number | null };
}

const clamp = (v: number | null | undefined, lo: number, hi: number): number | null => (v == null || !Number.isFinite(v) || v < lo ? null : Math.min(v, hi));

/** Phone fixes → report points (speed from m/s to km/h; phones say -1 for "unknown"). */
export function toPoints(locations: PhoneLocation[]): ReportPoint[] {
  return locations
    .filter((l) => Number.isFinite(l.coords.latitude) && Number.isFinite(l.coords.longitude) && Math.abs(l.coords.latitude) <= 90 && Math.abs(l.coords.longitude) <= 180)
    .map((l) => ({
      latitude: l.coords.latitude,
      longitude: l.coords.longitude,
      speedKph: l.coords.speed != null && l.coords.speed >= 0 ? Math.min(Math.round(l.coords.speed * 3.6 * 10) / 10, 400) : null,
      headingDeg: clamp(l.coords.heading, 0, 360),
      altitudeM: l.coords.altitude == null || !Number.isFinite(l.coords.altitude) ? null : Math.max(-1000, Math.min(l.coords.altitude, 10000)),
      accuracyM: clamp(l.coords.accuracy, 0, 100000),
      recordedAt: new Date(l.timestamp).toISOString()
    }));
}

/** Points waiting for signal: oldest first, no repeats, at most `max` (the newest are kept). */
export function mergeQueue(queue: ReportPoint[], add: ReportPoint[], max = 500): ReportPoint[] {
  const seen = new Set<string>();
  const all = [...queue, ...add]
    .filter((p) => {
      const k = `${p.recordedAt}|${p.latitude}|${p.longitude}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  return all.slice(Math.max(0, all.length - max));
}

/** "Good morning" by the phone's clock. */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export interface DriverLoad {
  id: string;
  reference: string;
  status: string;
  notes: string | null;
  pickup: { name: string | null; address: string; lat: number; lon: number; appointmentAt: string | null };
  delivery: { name: string | null; address: string; lat: number; lon: number; appointmentAt: string | null };
  deliveredAt: string | null;
  /** The company the load came from (older servers leave it out). */
  from?: { id: string; name: string };
}

/** The load the driver is working on now: on the road first, then the next pickup. */
export function currentLoad(loads: DriverLoad[]): DriverLoad | null {
  const order = ["at_delivery", "in_transit", "at_pickup", "tracking", "invited"];
  for (const s of order) {
    const hit = loads.find((l) => l.status === s);
    if (hit) return hit;
  }
  return null;
}

/** Plain words for a load's stage, and which stop comes next. */
export function loadStage(status: string): { label: string; tone: "brand" | "warning" | "success" | "neutral"; next: "pickup" | "delivery" | null } {
  switch (status) {
    case "invited":
    case "tracking":
      return { label: "Next", tone: "brand", next: "pickup" };
    case "at_pickup":
      return { label: "At pickup", tone: "warning", next: "pickup" };
    case "in_transit":
      return { label: "In transit", tone: "brand", next: "delivery" };
    case "at_delivery":
      return { label: "At delivery", tone: "warning", next: "delivery" };
    case "delivered":
      return { label: "Delivered", tone: "success", next: null };
    default:
      return { label: status, tone: "neutral", next: null };
  }
}

/** Short place name: the stop's name, or the start of its address. */
export const placeName = (s: { name: string | null; address: string }): string => s.name?.trim() || s.address.split(",")[0]!.trim();

/** "2 min ago", "1 h ago" for last update lines. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** The invite token from a link: riogps://driver?t=…, https://app.riogps.com/driver-app?t=…, or the bare token. */
export function inviteToken(input: string): string | null {
  const s = input.trim();
  const m = /[?&]t=([A-Za-z0-9_-]{16,128})/.exec(s);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{16,128}$/.test(s) ? s : null;
}

/** "3 h 20 min" from minutes. */
export function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
