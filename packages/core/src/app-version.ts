/**
 * Mobile app versions and update policy, shared by the server and the app so both decide
 * "up to date / update available / update required" the same way.
 *
 * Versions are plain "major.minor.patch" (the app's `version` in app.json). Raise it for every
 * store release; the platform console sets, per platform, the latest version and the lowest
 * version still allowed to sign in and load data.
 */
export const APP_PLATFORMS = ["android", "ios"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Sent by the app on every request so the server can refuse versions that are too old. */
export const APP_VERSION_HEADER = "x-rio-app-version";
export const APP_PLATFORM_HEADER = "x-rio-app-platform";

/** -1, 0 or 1. Missing parts count as 0 ("1.2" = "1.2.0"); anything unreadable counts as 0.0.0. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split(".").map(Number) : [0]);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface AppReleasePolicy {
  /** Newest version in the stores; older apps are offered an update they can postpone. */
  latestVersion: string | null;
  /** Lowest version allowed; older apps must update before they can be used. */
  minVersion: string | null;
  /** Where the Update button goes (Play Store / App Store page, or a download link). */
  updateUrl: string | null;
  /** Short "what's new", shown on the update screen. */
  notes: string | null;
}

export type UpdateStatus = "current" | "optional" | "required";

export function updateStatus(current: string, policy: Pick<AppReleasePolicy, "latestVersion" | "minVersion">): UpdateStatus {
  if (policy.minVersion && compareVersions(current, policy.minVersion) < 0) return "required";
  if (policy.latestVersion && compareVersions(current, policy.latestVersion) < 0) return "optional";
  return "current";
}
