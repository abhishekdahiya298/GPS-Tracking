import { APP_PLATFORM_HEADER, APP_PLATFORMS, APP_VERSION_HEADER, APP_VERSION_RE, compareVersions, updateStatus, type AppPlatform, type AppReleasePolicy, type UpdateStatus } from "@rio-gps/core/app-version";
import { getDb, schema } from "@rio-gps/db";
import { z } from "zod";
import { writeAudit } from "./audit";
import { AppError } from "./errors";

/**
 * Mobile app update policy (platform console → Mobile app). Best practice for required updates:
 * - The server decides, so a release can be made mandatory without shipping anything.
 * - The app checks on start and on returning to the foreground, and shows a full-screen
 *   "Update required" (no way past it) or a postponable "Update available".
 * - The API also refuses too-old apps (426), so even an app that skipped the check can't use
 *   data the old version no longer understands.
 * - If the check itself fails (no signal, server down) the app keeps working: an outage must
 *   never lock drivers out.
 */

type Meta = { ipAddress: string | null; userAgent: string | null };

const version = z
  .string()
  .trim()
  .regex(APP_VERSION_RE, "Use the form 1.2.0")
  .nullable()
  .or(z.literal("").transform(() => null));

export const AppReleaseInputSchema = z
  .object({
    latestVersion: version,
    minVersion: version,
    updateUrl: z
      .string()
      .trim()
      .url("Enter a full link, starting with https://")
      .refine((u) => u.startsWith("https://"), "The link must start with https://")
      .nullable()
      .or(z.literal("").transform(() => null)),
    notes: z.string().trim().max(500).nullable().or(z.literal("").transform(() => null))
  })
  .refine((v) => !v.minVersion || !v.latestVersion || compareVersions(v.minVersion, v.latestVersion) <= 0, { message: "The required version can't be newer than the latest version", path: ["minVersion"] })
  .refine((v) => !(v.minVersion || v.latestVersion) || v.updateUrl, { message: "Add the store or download link, so the Update button has somewhere to go", path: ["updateUrl"] });

export interface AppReleaseDto extends AppReleasePolicy {
  platform: AppPlatform;
  updatedAt: string | null;
}

const EMPTY: AppReleasePolicy = { latestVersion: null, minVersion: null, updateUrl: null, notes: null };

// The policy is read on every request from the app: a short per-process cache keeps that free.
const TTL_MS = 60_000;
const g = globalThis as unknown as { __rioAppReleases?: { at: number; rows: Map<AppPlatform, AppReleaseDto> } };

async function loadAll(now = Date.now()): Promise<Map<AppPlatform, AppReleaseDto>> {
  if (g.__rioAppReleases && now - g.__rioAppReleases.at < TTL_MS) return g.__rioAppReleases.rows;
  const rows = await getDb().select().from(schema.appReleases);
  const map = new Map<AppPlatform, AppReleaseDto>();
  for (const p of APP_PLATFORMS) {
    const r = rows.find((x) => x.platform === p);
    map.set(p, r ? { platform: p, latestVersion: r.latestVersion, minVersion: r.minVersion, updateUrl: r.updateUrl, notes: r.notes, updatedAt: r.updatedAt.toISOString() } : { platform: p, ...EMPTY, updatedAt: null });
  }
  g.__rioAppReleases = { at: now, rows: map };
  return map;
}

export function clearAppReleaseCache() {
  delete g.__rioAppReleases;
}

export async function listAppReleases(): Promise<AppReleaseDto[]> {
  clearAppReleaseCache();
  return [...(await loadAll()).values()];
}

export async function setAppRelease(actorUserId: string, platform: AppPlatform, input: z.infer<typeof AppReleaseInputSchema>, meta: Meta): Promise<void> {
  const values = { latestVersion: input.latestVersion, minVersion: input.minVersion, updateUrl: input.updateUrl, notes: input.notes, updatedAt: new Date(), updatedBy: actorUserId };
  await getDb()
    .insert(schema.appReleases)
    .values({ platform, ...values })
    .onConflictDoUpdate({ target: schema.appReleases.platform, set: values });
  clearAppReleaseCache();
  await writeAudit({ action: "app.release_updated", actorUserId, targetType: "app", targetId: null, metadata: { platform, latestVersion: input.latestVersion, minVersion: input.minVersion }, ...meta });
}

export const AppCheckQuery = z.object({ platform: z.enum(APP_PLATFORMS), version: z.string().trim().regex(/^\d+(\.\d+){0,3}$/) });

/** What the app should do now. Public (the app asks before anyone signs in). */
export async function checkAppVersion(platform: AppPlatform, current: string): Promise<{ status: UpdateStatus } & AppReleasePolicy> {
  const p = (await loadAll()).get(platform)!;
  const status = updateStatus(current, p);
  return { status, latestVersion: p.latestVersion, minVersion: p.minVersion, updateUrl: p.updateUrl, notes: p.notes };
}

export class UpdateRequiredError extends AppError {
  constructor(public readonly policy: AppReleasePolicy) {
    super("UPDATE_REQUIRED", 426, "This version of the RIO GPS app is no longer supported. Please update the app.");
  }
}

/**
 * Refuses API calls from an app older than the required version. Only requests that say they
 * come from the app (its version header) are checked; the website is never affected.
 */
export async function assertAppVersionAllowed(headers: Headers): Promise<void> {
  const v = headers.get(APP_VERSION_HEADER);
  const platform = headers.get(APP_PLATFORM_HEADER) as AppPlatform | null;
  if (!v || !platform || !(APP_PLATFORMS as readonly string[]).includes(platform)) return;
  const p = (await loadAll()).get(platform)!;
  if (updateStatus(v, p) === "required") throw new UpdateRequiredError(p);
}
