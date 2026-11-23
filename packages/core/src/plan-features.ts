import type { Permission } from "./rbac.js";

/**
 * What a plan can include, feature by feature, and the limits it sets. The platform console's
 * Plans matrix edits these per plan; each customer's terms are copied from the plan and can be
 * changed for that customer only.
 *
 * Plans store the features they do NOT include ("locked"), so a plan or customer from before
 * features existed (empty list) keeps everything, and limits left out mean "no limit".
 */
export const FEATURES = [
  "live_map",
  "gps_trackers",
  "trip_history",
  "vehicles",
  "drivers",
  "maintenance",
  "loads",
  "shipper_links",
  "loads_map",
  "alerts",
  "zones",
  "reports",
  "emailed_reports",
  "team",
  "mobile_app",
  "csv_export"
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_GROUPS: readonly { title: string; features: readonly Feature[] }[] = [
  { title: "Tracking", features: ["live_map", "gps_trackers", "trip_history"] },
  { title: "Fleet", features: ["vehicles", "drivers", "maintenance"] },
  { title: "Loads", features: ["loads", "shipper_links", "loads_map"] },
  { title: "Monitoring", features: ["alerts", "zones", "reports", "emailed_reports"] },
  { title: "Account", features: ["team", "mobile_app", "csv_export"] }
];

export const FEATURE_LABEL: Readonly<Record<Feature, string>> = {
  live_map: "Live map (driver's phone)",
  gps_trackers: "GPS hardware trackers",
  trip_history: "Trip history and replay",
  vehicles: "Vehicles",
  drivers: "Drivers",
  maintenance: "Maintenance and renewals",
  loads: "Loads with driver link",
  shipper_links: "Shipper tracking links",
  loads_map: "Loads map",
  alerts: "Alerts and notifications",
  zones: "Zones",
  reports: "Reports",
  emailed_reports: "Emailed reports",
  team: "Team members",
  mobile_app: "Mobile app",
  csv_export: "Export to CSV"
};

/** One line under the feature name on lock screens. */
export const FEATURE_PITCH: Readonly<Record<Feature, string>> = {
  live_map: "See every truck on one map",
  gps_trackers: "No phone needed, trailers too",
  trip_history: "Replay any day, stop by stop",
  vehicles: "Trucks and trailers",
  drivers: "Who drives what",
  maintenance: "Services and renewals",
  loads: "The driver gets a link and shares their location",
  shipper_links: "Your customer follows the load live",
  loads_map: "All loads on one map",
  alerts: "Speeding, idling, arrivals, no signal",
  zones: "Yards, customers, borders",
  reports: "Mileage, stops, idling, trips",
  emailed_reports: "Reports in your inbox every week",
  team: "Dispatchers and managers",
  mobile_app: "See your trucks from your phone",
  csv_export: "Take your data to Excel"
};

/**
 * Permissions that only work when the feature is in the plan. Features that aren't listed here
 * (reports, trip history, loads map, CSV export, mobile app, shipper links) are checked by the
 * pages and APIs that offer them.
 */
export const FEATURE_PERMISSIONS: Readonly<Partial<Record<Feature, readonly Permission[]>>> = {
  live_map: ["locations.read"],
  gps_trackers: ["devices.read", "devices.assign", "devices.unassign", "devices.manage"],
  vehicles: ["vehicles.create", "vehicles.update", "vehicles.delete"],
  maintenance: ["maintenance.read", "maintenance.write"],
  loads: ["loads.read", "loads.write"],
  alerts: ["alerts.read", "alerts.write"],
  zones: ["geofences.read", "geofences.write"],
  emailed_reports: ["reports.manage"],
  team: ["users.manage"]
};

const PERMISSION_FEATURE = new Map<Permission, Feature>(
  (Object.entries(FEATURE_PERMISSIONS) as [Feature, readonly Permission[]][]).flatMap(([f, ps]) => ps.map((p) => [p, f] as const))
);

/** The feature a permission needs, or null when no feature gates it. */
export function featureOf(permission: Permission): Feature | null {
  return PERMISSION_FEATURE.get(permission) ?? null;
}

export const LIMITS = ["vehicles", "drivers", "members", "trackers", "loadsPerMonth", "historyDays"] as const;
export type LimitKey = (typeof LIMITS)[number];
/** A missing key means no limit. */
export type PlanLimits = Partial<Record<LimitKey, number>>;

export const LIMIT_LABEL: Readonly<Record<LimitKey, string>> = {
  vehicles: "Trucks and trailers",
  drivers: "Drivers",
  members: "Team members",
  trackers: "GPS trackers",
  loadsPerMonth: "Loads per month",
  historyDays: "History (days)"
};

/** "trucks", "drivers"… as used in "You've added 2 of 2 trucks". */
export const LIMIT_NOUN: Readonly<Record<LimitKey, string>> = {
  vehicles: "trucks and trailers",
  drivers: "drivers",
  members: "team members",
  trackers: "GPS trackers",
  loadsPerMonth: "loads this month",
  historyDays: "days of history"
};

/** What a customer sees for a feature that isn't in their plan. */
export type FeatureRule = "lock" | "hide";
export const DEFAULT_FEATURE_RULES: Readonly<Record<Feature, FeatureRule>> = Object.fromEntries(
  FEATURES.map((f) => [f, f === "shipper_links" || f === "loads_map" ? "hide" : "lock"])
) as Record<Feature, FeatureRule>;

export function isFeature(v: unknown): v is Feature {
  return typeof v === "string" && (FEATURES as readonly string[]).includes(v);
}

/** Keeps only known features, sorted and without repeats. */
export function cleanFeatures(list: readonly unknown[] | null | undefined): Feature[] {
  return [...new Set((list ?? []).filter(isFeature))].sort() as Feature[];
}

/** Keeps only known limit keys with whole numbers ≥ 0. */
export function cleanLimits(raw: unknown): PlanLimits {
  const out: PlanLimits = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of LIMITS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

/** "2 of 2" style check: true when one more would go over the limit. */
export function atLimit(limits: PlanLimits, key: LimitKey, used: number): boolean {
  const max = limits[key];
  return max !== undefined && used >= max;
}
