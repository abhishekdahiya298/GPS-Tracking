import type { AppReleasePolicy, UpdateStatus } from "@rio-gps/core/app-version";

export type UpdateCheck = { status: UpdateStatus } & AppReleasePolicy;

/**
 * Asks the server whether this version is current, may update, or must update.
 * Returns null when the answer can't be had (no signal, server down): the app then keeps
 * working, because an outage must never lock people out.
 */
export async function fetchUpdatePolicy(opts: { baseUrl: string; platform: string; version: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<UpdateCheck | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  try {
    const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/v1/app/version?platform=${encodeURIComponent(opts.platform)}&version=${encodeURIComponent(opts.version)}`;
    const res = await (opts.fetchImpl ?? fetch)(url, { headers: { Accept: "application/json" }, credentials: "omit", signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<UpdateCheck>;
    if (body.status !== "current" && body.status !== "optional" && body.status !== "required") return null;
    return { status: body.status, latestVersion: body.latestVersion ?? null, minVersion: body.minVersion ?? null, updateUrl: body.updateUrl ?? null, notes: body.notes ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Later" hides the optional prompt for a day, or until a newer version is out. */
export const SNOOZE_MS = 24 * 3_600_000;
export function isSnoozed(snooze: { version: string; at: number } | null, latest: string | null, now = Date.now()): boolean {
  return Boolean(snooze && latest && snooze.version === latest && now - snooze.at < SNOOZE_MS);
}
