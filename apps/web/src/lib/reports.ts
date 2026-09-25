import { csvCell, detectTrips, summarizeByDay, type DaySummary, type Trip } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { ValidationError } from "./errors";

/** Upper bound on points processed per report (≈ 31 days of dense driving). */
export const MAX_REPORT_POINTS = 200_000;

export interface TripDto {
  startAt: string;
  endAt: string;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  distanceKm: number;
  durationMin: number;
  drivingMin: number;
  idleMin: number;
  maxSpeedKph: number;
  avgMovingKph: number;
}

export interface TripReport {
  deviceId: string;
  from: string;
  to: string;
  timeZone: string;
  trips: TripDto[];
  days: (Omit<DaySummary, "distanceM" | "drivingS"> & { distanceKm: number; drivingMin: number })[];
  totals: { trips: number; distanceKm: number; drivingMin: number; maxSpeedKph: number };
}

const km = (m: number) => Math.round(m / 100) / 10;
const minutes = (s: number) => Math.round(s / 60);

function toDto(t: Trip): TripDto {
  return {
    startAt: new Date(t.start.t).toISOString(),
    endAt: new Date(t.end.t).toISOString(),
    start: { lat: t.start.lat, lon: t.start.lon },
    end: { lat: t.end.lat, lon: t.end.lon },
    distanceKm: km(t.distanceM),
    durationMin: minutes(t.durationS),
    drivingMin: minutes(t.movingS),
    idleMin: minutes(t.idleS),
    maxSpeedKph: t.maxSpeedKph,
    avgMovingKph: t.avgMovingKph
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The caller has already verified the device belongs to organizationId. */
export async function buildTripReport(organizationId: string, deviceId: string, from: Date, to: Date, timeZone: string): Promise<TripReport> {
  const h = schema.locationHistory;
  const rows = await getDb()
    .select({ t: h.recordedAt, lat: h.latitude, lon: h.longitude, speedKph: h.speedKph, ignition: h.ignition })
    .from(h)
    .where(and(eq(h.organizationId, organizationId), eq(h.deviceId, deviceId), gte(h.recordedAt, from), lt(h.recordedAt, to)))
    .orderBy(asc(h.recordedAt))
    .limit(MAX_REPORT_POINTS + 1);
  if (rows.length > MAX_REPORT_POINTS) throw new ValidationError("Too much data in this range; choose a shorter period");

  const trips = detectTrips(rows.map((r) => ({ t: r.t.getTime(), lat: r.lat, lon: r.lon, speedKph: r.speedKph, ignition: r.ignition })));
  const days = summarizeByDay(trips, timeZone).map((d) => ({ day: d.day, trips: d.trips, maxSpeedKph: d.maxSpeedKph, distanceKm: km(d.distanceM), drivingMin: minutes(d.drivingS) }));
  return {
    deviceId,
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone,
    trips: trips.map(toDto),
    days,
    totals: {
      trips: trips.length,
      distanceKm: km(trips.reduce((a, t) => a + t.distanceM, 0)),
      drivingMin: minutes(trips.reduce((a, t) => a + t.movingS, 0)),
      maxSpeedKph: trips.reduce((a, t) => Math.max(a, t.maxSpeedKph), 0)
    }
  };
}

export function tripReportCsv(r: TripReport, vehicleLabel: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: r.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const head = ["vehicle", "start_local", "end_local", "duration_min", "driving_min", "idle_min", "distance_km", "max_speed_kph", "avg_moving_kph", "start_lat", "start_lon", "end_lat", "end_lon"];
  const lines = r.trips.map((t) =>
    [vehicleLabel, fmt(t.startAt), fmt(t.endAt), t.durationMin, t.drivingMin, t.idleMin, t.distanceKm, t.maxSpeedKph, t.avgMovingKph, t.start.lat.toFixed(6), t.start.lon.toFixed(6), t.end.lat.toFixed(6), t.end.lon.toFixed(6)].map(csvCell).join(",")
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
