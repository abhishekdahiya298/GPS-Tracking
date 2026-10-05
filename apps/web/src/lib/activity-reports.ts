import { csvCell, detectIdling, detectSpeeding, detectStops, detectTrips, mileageByDay, units, type UnitSystem } from "@rio-gps/core";
import { dateFormatter } from "@rio-gps/core/timezones";
import { z } from "zod";
import { getDb, schema } from "@rio-gps/db";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { loadTrack, MAX_REPORT_POINTS } from "./reports";
import { listDevices } from "./vehicles";

/**
 * Stoppage, idling, speeding and mileage reports. All are computed from stored GPS history
 * with the same trip engine as the Trip report; nothing is written. Tenant scoping: devices
 * are listed for ctx.organizationId and every track query carries the organization id.
 */
export const ACTIVITY_REPORT_TYPES = ["stops", "idling", "speeding", "mileage"] as const;
export type ActivityReportType = (typeof ACTIVITY_REPORT_TYPES)[number];

/**
 * Budget for one request across all vehicles. Tracks are processed one vehicle at a time, so
 * memory stays bounded by MAX_REPORT_POINTS; this bounds the time (≈ 150k points/s measured).
 */
export const MAX_ACTIVITY_POINTS = 2_000_000;
/** Rows returned to the browser / CSV. Totals always cover everything. */
export const MAX_ACTIVITY_ROWS = 5_000;

export const ActivityQuery = z.object({
  type: z.enum(ACTIVITY_REPORT_TYPES),
  /** One device, or "all" for every device in the organization. */
  deviceId: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  tz: z.string().max(64).optional(),
  /** Stops / idling: minimum duration in minutes. */
  minMinutes: z.coerce.number().int().min(1).max(1440).default(5),
  /** Speeding: limit in km/h (the UI converts from the organization's units). */
  limitKph: z.coerce.number().min(10).max(250).default(110),
  format: z.enum(["json", "csv"]).default("json")
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

interface Base {
  deviceId: string;
  vehicle: string;
}
export interface StopRow extends Base {
  startAt: string;
  endAt: string | null;
  durationMin: number;
  lat: number;
  lon: number;
}
export interface IdleRow extends Base {
  startAt: string;
  endAt: string;
  durationMin: number;
  lat: number;
  lon: number;
}
export interface SpeedRow extends Base {
  startAt: string;
  endAt: string;
  durationS: number;
  maxSpeedKph: number;
  overKph: number;
  lat: number;
  lon: number;
}
export interface MileageRow extends Base {
  day: string;
  distanceKm: number;
  drivingMin: number;
  idleMin: number;
  trips: number;
}
export interface VehicleTotal extends Base {
  count: number;
  durationMin: number;
  distanceKm: number;
  maxSpeedKph: number;
}

export interface ActivityReport {
  type: ActivityReportType;
  from: string;
  to: string;
  timeZone: string;
  minMinutes: number;
  limitKph: number;
  vehicles: number;
  rows: (StopRow | IdleRow | SpeedRow | MileageRow)[];
  /** Mileage only: distance per calendar month per vehicle. */
  months: { month: string; deviceId: string; vehicle: string; distanceKm: number; drivingMin: number; trips: number }[];
  byVehicle: VehicleTotal[];
  totals: { count: number; durationMin: number; distanceKm: number; maxSpeedKph: number };
  /** True when `rows` was cut at MAX_ACTIVITY_ROWS (totals and byVehicle are still complete). */
  truncated: boolean;
}

const iso = (t: number) => new Date(t).toISOString();
const km = (m: number) => Math.round(m / 100) / 10;
const mins = (s: number) => Math.round(s / 60);

export async function buildActivityReport(organizationId: string, q: ActivityQuery, timeZone: string, now = new Date()): Promise<ActivityReport> {
  const from = new Date(q.from);
  const to = new Date(q.to);
  const all = await listDevices(organizationId);
  const devices = q.deviceId === "all" ? all.filter((d) => d.status === "active") : all.filter((d) => d.id === q.deviceId);
  if (q.deviceId !== "all" && devices.length === 0) throw new NotFoundError("Device not found");
  const label = (d: (typeof all)[number]) => d.vehicle?.name ?? d.name ?? d.model ?? "Device";
  // An ongoing stop lasts until the end of the range, but never into the future.
  const untilT = Math.min(to.getTime(), now.getTime());

  // Size the job first: skip vehicles with no data in the range and fail fast (before any
  // heavy work) when the range is too large, saying how large it is.
  const h = schema.locationHistory;
  const counts = new Map(
    (
      await getDb()
        .select({ deviceId: h.deviceId, n: count() })
        .from(h)
        .where(and(eq(h.organizationId, organizationId), gte(h.recordedAt, from), lt(h.recordedAt, to), ...(q.deviceId === "all" ? [] : [eq(h.deviceId, q.deviceId)])))
        .groupBy(h.deviceId)
    ).map((r) => [r.deviceId, r.n])
  );
  const points = devices.reduce((a, d) => a + (counts.get(d.id) ?? 0), 0);
  const tooBig = devices.find((d) => (counts.get(d.id) ?? 0) > MAX_REPORT_POINTS);
  if (points > MAX_ACTIVITY_POINTS || tooBig) {
    const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${Math.round(n / 1000)},000`);
    throw new ValidationError(
      tooBig
        ? `${label(tooBig)} has about ${fmt(counts.get(tooBig.id)!)} GPS points in this range (limit ${fmt(MAX_REPORT_POINTS)} per vehicle). Choose a shorter period.`
        : `This range has about ${fmt(points)} GPS points (limit ${fmt(MAX_ACTIVITY_POINTS)}). Choose a shorter period or a single vehicle.`
    );
  }

  const rows: ActivityReport["rows"] = [];
  const months = new Map<string, ActivityReport["months"][number]>();
  const byVehicle: VehicleTotal[] = [];
  let total = 0;

  for (const d of devices) {
    if (!counts.has(d.id)) continue;
    const track = await loadTrack(organizationId, d.id, from, to);
    const base = { deviceId: d.id, vehicle: label(d) };
    const v: VehicleTotal = { ...base, count: 0, durationMin: 0, distanceKm: 0, maxSpeedKph: 0 };
    const add = (r: ActivityReport["rows"][number]) => {
      total++;
      if (rows.length < MAX_ACTIVITY_ROWS) rows.push(r);
    };

    if (q.type === "stops") {
      for (const s of detectStops(detectTrips(track), untilT, q.minMinutes)) {
        v.count++;
        v.durationMin += mins(s.durationS);
        add({ ...base, startAt: iso(s.startT), endAt: s.endT === null ? null : iso(s.endT), durationMin: mins(s.durationS), lat: s.lat, lon: s.lon });
      }
    } else if (q.type === "idling") {
      for (const s of detectIdling(track, q.minMinutes)) {
        v.count++;
        v.durationMin += mins(s.durationS);
        add({ ...base, startAt: iso(s.startT), endAt: iso(s.endT), durationMin: mins(s.durationS), lat: s.lat, lon: s.lon });
      }
    } else if (q.type === "speeding") {
      for (const s of detectSpeeding(track, q.limitKph)) {
        v.count++;
        v.durationMin += s.durationS / 60;
        v.maxSpeedKph = Math.max(v.maxSpeedKph, s.maxSpeedKph);
        add({ ...base, startAt: iso(s.startT), endAt: iso(s.endT), durationS: s.durationS, maxSpeedKph: s.maxSpeedKph, overKph: Math.round(s.maxSpeedKph - q.limitKph), lat: s.lat, lon: s.lon });
      }
      v.durationMin = Math.round(v.durationMin);
    } else {
      for (const day of mileageByDay(track, timeZone)) {
        v.count += day.trips;
        v.durationMin += mins(day.drivingS);
        v.distanceKm += day.distanceM / 1000;
        add({ ...base, day: day.day, distanceKm: km(day.distanceM), drivingMin: mins(day.drivingS), idleMin: mins(day.idleS), trips: day.trips });
        const key = `${day.day.slice(0, 7)}|${d.id}`;
        const m = months.get(key) ?? { month: day.day.slice(0, 7), ...base, distanceKm: 0, drivingMin: 0, trips: 0 };
        m.distanceKm += day.distanceM / 1000;
        m.drivingMin += mins(day.drivingS);
        m.trips += day.trips;
        months.set(key, m);
      }
      v.distanceKm = Math.round(v.distanceKm * 10) / 10;
    }
    if (v.count > 0 || v.distanceKm > 0) byVehicle.push(v);
  }

  // Newest first for event reports; mileage by day then vehicle.
  if (q.type === "mileage") (rows as MileageRow[]).sort((a, b) => b.day.localeCompare(a.day) || a.vehicle.localeCompare(b.vehicle));
  else (rows as StopRow[]).sort((a, b) => b.startAt.localeCompare(a.startAt));

  return {
    type: q.type,
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone,
    minMinutes: q.minMinutes,
    limitKph: q.limitKph,
    vehicles: devices.length,
    rows,
    months: [...months.values()].map((m) => ({ ...m, distanceKm: Math.round(m.distanceKm * 10) / 10 })).sort((a, b) => b.month.localeCompare(a.month) || a.vehicle.localeCompare(b.vehicle)),
    byVehicle: byVehicle.sort((a, b) => (q.type === "mileage" ? b.distanceKm - a.distanceKm : b.durationMin - a.durationMin || b.count - a.count)),
    totals: {
      count: byVehicle.reduce((a, x) => a + x.count, 0),
      durationMin: byVehicle.reduce((a, x) => a + x.durationMin, 0),
      distanceKm: Math.round(byVehicle.reduce((a, x) => a + x.distanceKm, 0) * 10) / 10,
      maxSpeedKph: byVehicle.reduce((a, x) => Math.max(a, x.maxSpeedKph), 0)
    },
    truncated: total > rows.length
  };
}

/** CSV in the organization's display units; times are local 24-hour with a zone column. */
export function activityReportCsv(r: ActivityReport, system: UnitSystem): string {
  const u = units(system);
  const f = dateFormatter(r.timeZone, "24h");
  const du = system === "imperial" ? "mi" : "km";
  const su = system === "imperial" ? "mph" : "kph";
  const d1 = (k: number) => Math.round(u.dist(k) * 10) / 10;
  const s0 = (k: number) => Math.round(u.speed_(k));
  const pos = (x: { lat: number; lon: number }) => [x.lat.toFixed(6), x.lon.toFixed(6)];
  let head: string[];
  let lines: (string | number | null)[][];
  if (r.type === "stops") {
    head = ["vehicle", "start_local", "end_local", "duration_min", "lat", "lon", "time_zone"];
    lines = (r.rows as StopRow[]).map((x) => [x.vehicle, f.iso(x.startAt), x.endAt ? f.iso(x.endAt) : "ongoing", x.durationMin, ...pos(x), f.abbr(x.startAt)]);
  } else if (r.type === "idling") {
    head = ["vehicle", "start_local", "end_local", "duration_min", "lat", "lon", "time_zone"];
    lines = (r.rows as IdleRow[]).map((x) => [x.vehicle, f.iso(x.startAt), f.iso(x.endAt), x.durationMin, ...pos(x), f.abbr(x.startAt)]);
  } else if (r.type === "speeding") {
    head = ["vehicle", "start_local", "end_local", "duration_s", `max_speed_${su}`, `limit_${su}`, "lat", "lon", "time_zone"];
    lines = (r.rows as SpeedRow[]).map((x) => [x.vehicle, f.iso(x.startAt), f.iso(x.endAt), x.durationS, s0(x.maxSpeedKph), s0(r.limitKph), ...pos(x), f.abbr(x.startAt)]);
  } else {
    head = ["vehicle", "day", `distance_${du}`, "driving_min", "idle_min", "trips"];
    lines = (r.rows as MileageRow[]).map((x) => [x.vehicle, x.day, d1(x.distanceKm), x.drivingMin, x.idleMin, x.trips]);
  }
  return [head.join(","), ...lines.map((l) => l.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
