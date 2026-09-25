/**
 * Presentation-only unit conversion. RIO stores metric (km, km/h) exactly as
 * received; organizations choose how values are displayed (US: imperial,
 * Canada: metric). Inputs typed in the display unit are converted back to
 * metric at the edge, before validation/storage.
 */
export type UnitSystem = "imperial" | "metric";
export const UNIT_SYSTEMS = ["imperial", "metric"] as const;

export const KM_PER_MILE = 1.609344;

export interface Units {
  system: UnitSystem;
  distance: "mi" | "km";
  speed: "mph" | "km/h";
  /** km → display distance */
  dist(km: number): number;
  /** km/h → display speed */
  speed_(kph: number): number;
  /** display distance → km */
  toKm(v: number): number;
  /** display speed → km/h */
  toKph(v: number): number;
  fmtDist(km: number | null | undefined, digits?: number): string;
  fmtSpeed(kph: number | null | undefined): string;
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export function units(system: UnitSystem): Units {
  const imperial = system === "imperial";
  const dist = (km: number) => (imperial ? km / KM_PER_MILE : km);
  const speed_ = (kph: number) => (imperial ? kph / KM_PER_MILE : kph);
  return {
    system,
    distance: imperial ? "mi" : "km",
    speed: imperial ? "mph" : "km/h",
    dist,
    speed_,
    toKm: (v) => (imperial ? v * KM_PER_MILE : v),
    toKph: (v) => (imperial ? v * KM_PER_MILE : v),
    fmtDist: (km, digits = 1) => {
      if (km === null || km === undefined) return "—";
      const v = round(dist(km), digits);
      const unit = imperial ? "mi" : "km";
      if (v === 0 && km > 0) return `< ${(1 / 10 ** digits).toString()} ${unit}`;
      return `${v.toLocaleString("en-US")} ${unit}`;
    },
    fmtSpeed: (kph) => (kph === null || kph === undefined ? "—" : `${Math.round(speed_(kph))} ${imperial ? "mph" : "km/h"}`)
  };
}
