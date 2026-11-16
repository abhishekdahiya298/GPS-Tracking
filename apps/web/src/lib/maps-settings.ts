import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ValidationError } from "./errors";

/**
 * Maps & addresses (platform console → Maps & addresses). The platform admin picks:
 * - the address service that turns tracker coordinates into street addresses, for the app and
 *   the website alike (the server looks addresses up, so keys never reach a phone or browser);
 * - the map look customers start with.
 * Service keys live in the server environment (RIO_GEOAPIFY_KEY, RIO_GOOGLE_MAPS_KEY);
 * a service whose key is missing can't be chosen.
 */
export const ADDRESS_PROVIDERS = ["off", "osm", "geoapify", "google"] as const;
export type AddressProvider = (typeof ADDRESS_PROVIDERS)[number];
export const MAP_STYLES = ["streets", "light", "dark"] as const;
export type MapStyleChoice = (typeof MAP_STYLES)[number];

export const ICON_STYLES = ["photo", "pin", "circle", "square", "top"] as const;
export const ICON_COLORS = ["status", "type"] as const;
/** Map drawn in the phone app: OpenStreetMap (free everywhere) or the phone's own (Apple Maps on iPhone, free; Google Maps on Android when the build has a key). */
export const MOBILE_MAPS = ["osm", "native"] as const;

export interface MapsSettings {
  addressProvider: AddressProvider;
  mapStyle: MapStyleChoice;
  /** Default map icons for everyone; each person can still pick their own (app Account / web My account). */
  iconStyle: (typeof ICON_STYLES)[number];
  iconColor: (typeof ICON_COLORS)[number];
  mobileMap: (typeof MOBILE_MAPS)[number];
}

export const DEFAULT_MAPS_SETTINGS: MapsSettings = { addressProvider: "off", mapStyle: "streets", iconStyle: "photo", iconColor: "status", mobileMap: "osm" };

export const MapsSettingsSchema = z.object({
  addressProvider: z.enum(ADDRESS_PROVIDERS),
  mapStyle: z.enum(MAP_STYLES),
  // Saved before these existed: fall back to the defaults instead of losing the rest.
  iconStyle: z.enum(ICON_STYLES).default("photo"),
  iconColor: z.enum(ICON_COLORS).default("status"),
  mobileMap: z.enum(MOBILE_MAPS).default("osm")
});

/** Which services have a key on this server (OpenStreetMap needs none). */
export function providerKeys(env: NodeJS.ProcessEnv = process.env): Record<AddressProvider, boolean> {
  return { off: true, osm: true, geoapify: Boolean(env.RIO_GEOAPIFY_KEY), google: Boolean(env.RIO_GOOGLE_MAPS_KEY) };
}

const KEY = "maps";
// Read on every address lookup: a short per-process cache keeps that free.
const TTL_MS = 60_000;
const g = globalThis as unknown as { __rioMaps?: { at: number; value: MapsSettings } };

/** Fresh read (the console page): drop the per-process copy first. */
export function clearMapsSettingsCache() {
  delete g.__rioMaps;
}

export function parseMapsSettings(raw: unknown): MapsSettings {
  const r = MapsSettingsSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_MAPS_SETTINGS;
}

export async function getMapsSettings(now = Date.now()): Promise<MapsSettings> {
  if (g.__rioMaps && now - g.__rioMaps.at < TTL_MS) return g.__rioMaps.value;
  let value = DEFAULT_MAPS_SETTINGS;
  try {
    const [row] = await getDb().select().from(schema.platformSettings).where(eq(schema.platformSettings.key, KEY)).limit(1);
    value = parseMapsSettings(row?.value);
  } catch {
    // Table missing during a deploy, or the database is busy: fall back to the safe default.
  }
  g.__rioMaps = { at: now, value };
  return value;
}

export async function setMapsSettings(actorUserId: string, input: MapsSettings, meta: { ipAddress: string | null; userAgent: string | null }): Promise<void> {
  const keys = providerKeys();
  if (!keys[input.addressProvider]) throw new ValidationError("That address service has no key on the server yet.");
  const values = { value: input, updatedAt: new Date(), updatedBy: actorUserId };
  await getDb()
    .insert(schema.platformSettings)
    .values({ key: KEY, ...values })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: values });
  delete g.__rioMaps;
  await writeAudit({ action: "platform.maps_updated", actorUserId, targetType: "platform", targetId: null, metadata: { ...input }, ...meta });
}
