import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";

/**
 * Platform-wide settings the RIO team changes in the console (Platform → Platform settings)
 * instead of in code: support contacts, driver app thresholds and defaults for new companies.
 * Stored in platform_settings under one key; every value has a safe default.
 */
const KEY = "platform";

export const PlatformSettingsSchema = z.object({
  supportEmail: z.string().trim().email("Enter an email like support@riogps.com").max(200).default("support@riogps.com"),
  supportPhone: z.string().trim().max(40).default(""),
  /** A signed-in phone that hasn't reported for this long shows "Not heard from". */
  driverStaleMinutes: z.coerce.number().int().min(5).max(24 * 60).default(30),
  /** Personal driver app invite links work this many days. */
  driverInviteDays: z.coerce.number().int().min(1).max(30).default(7),
  /** Phone positions less accurate than this are dropped (metres). */
  driverMaxAccuracyM: z.coerce.number().int().min(20).max(2000).default(200),
  /**
   * Test numbers for the driver app, one per line or comma: sign-in codes for these show in the app
   * instead of a text (for testing and store review until texts work). Never real drivers' numbers.
   */
  driverTestNumbers: z.string().trim().max(2000).default(""),
  defaultCountry: z.enum(["CA", "US"]).default("CA"),
  defaultTimeZone: z.string().trim().min(1).max(64).default("America/Toronto"),
  defaultUnitSystem: z.enum(["imperial", "metric"]).default("imperial")
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = PlatformSettingsSchema.parse({});

const TTL_MS = 60_000;
const g = globalThis as unknown as { __rioPlatform?: { at: number; value: PlatformSettings } };

export function parsePlatformSettings(raw: unknown): PlatformSettings {
  const r = PlatformSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_PLATFORM_SETTINGS;
}

export async function getPlatformSettings(now = Date.now()): Promise<PlatformSettings> {
  if (g.__rioPlatform && now - g.__rioPlatform.at < TTL_MS) return g.__rioPlatform.value;
  let value = DEFAULT_PLATFORM_SETTINGS;
  try {
    const [row] = await getDb().select().from(schema.platformSettings).where(eq(schema.platformSettings.key, KEY)).limit(1);
    value = parsePlatformSettings(row?.value);
  } catch {
    // Database busy or mid-deploy: the defaults are safe.
  }
  g.__rioPlatform = { at: now, value };
  return value;
}

export function clearPlatformSettingsCache() {
  delete g.__rioPlatform;
}

export async function setPlatformSettings(actorUserId: string, input: PlatformSettings, meta: { ipAddress: string | null; userAgent: string | null }): Promise<void> {
  const values = { value: input, updatedAt: new Date(), updatedBy: actorUserId };
  await getDb().insert(schema.platformSettings).values({ key: KEY, ...values }).onConflictDoUpdate({ target: schema.platformSettings.key, set: values });
  delete g.__rioPlatform;
  await writeAudit({ action: "platform.settings_updated", actorUserId, targetType: "platform", targetId: null, metadata: { ...input }, ...meta });
}
