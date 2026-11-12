import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";

/**
 * Address search for load stops, through OpenStreetMap's Nominatim. Nominatim's usage policy
 * allows at most one request per second with an identifying User-Agent, and asks that results
 * be cached; both are done here (a shared per-second slot and a 7-day cache in Redis).
 * Coordinates typed as "lat, lon" are answered directly without a lookup.
 */
export interface GeocodeResult {
  /** Clean postal-style address: "100 Front Street West, Toronto, ON M5J 1E3, Canada". */
  label: string;
  /** A business or landmark name when the result is one (e.g. "Fairmont Royal York"). */
  name?: string | null;
  latitude: number;
  longitude: number;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "RIO GPS load tracking (support@riogps.com)";
const CACHE_SECONDS = 7 * 24 * 3600;

interface NominatimRow {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}

/**
 * Builds "street, city, ST postcode, country" from Nominatim's address parts, instead of its
 * long display name ("…, Urban agglomeration of Montreal, Montreal (administrative region), …").
 * Falls back to the display name when the parts are missing.
 */
export function cleanAddress(r: NominatimRow): { label: string; name: string | null } {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? a.county ?? null;
  const iso = a["ISO3166-2-lvl4"];
  const state = iso && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) ? iso.split("-")[1]! : (a.state ?? null);
  const region = [state, a.postcode].filter(Boolean).join(" ");
  const label = [street, city, region, a.country].filter(Boolean).join(", ");
  const name = r.name && r.name !== a.road && r.name !== city ? r.name : null;
  if (!city && !street) return { label: String(r.display_name ?? ""), name };
  return { label, name };
}

export function parseCoordinates(q: string): GeocodeResult | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { label: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, latitude, longitude };
}

async function waitForSlot(): Promise<void> {
  try {
    const redis = await getReadyRedisPublisher();
    for (let i = 0; i < 12; i++) {
      if ((await redis.set("geocode:slot", "1", "PX", 1_100, "NX")) === "OK") return;
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch {
    // Without Redis there is no shared slot; the per-user limit still bounds the rate.
  }
}

export async function geocode(q: string, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const query = q.trim().replace(/\s+/g, " ").slice(0, 200);
  if (query.length < 3) return [];
  const coords = parseCoordinates(query);
  if (coords) return [coords];

  const cacheKey = `geocode:v2:${query.toLowerCase()}`;
  try {
    const cached = await (await getReadyRedisPublisher()).get(cacheKey);
    if (cached) return JSON.parse(cached) as GeocodeResult[];
  } catch {
    // cache is optional
  }

  await waitForSlot();
  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "6", countrycodes: "us,ca,mx", addressdetails: "1" })}`;
  let results: GeocodeResult[];
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      logger.warn("geocode.http_error", { status: res.status });
      return [];
    }
    const rows = (await res.json()) as NominatimRow[];
    results = rows
      .map((r) => ({ ...cleanAddress(r), latitude: Number(r.lat), longitude: Number(r.lon) }))
      .filter((r) => r.label && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  } catch (err) {
    logger.warn("geocode.failed", {}, err);
    return [];
  }
  try {
    await (await getReadyRedisPublisher()).set(cacheKey, JSON.stringify(results), "EX", CACHE_SECONDS);
  } catch {
    // ignore
  }
  return results;
}

// ---------- address of a position (reverse lookup) ----------

const REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const REVERSE_CACHE_SECONDS = 30 * 24 * 3600;

/**
 * A short street address for a vehicle card: "1200 Lenwood Road, Barstow, CA 92311".
 * More local detail than cleanAddress (neighbourhood when there is no street), no country.
 */
export function streetAddress(r: NominatimRow): string {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? null;
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? null;
  const iso = a["ISO3166-2-lvl4"];
  const state = iso && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) ? iso.split("-")[1]! : (a.state ?? null);
  const region = [state, a.postcode].filter(Boolean).join(" ");
  const parts = [street || (r.name && r.name !== city ? r.name : null), area && area !== city ? area : null, city, region].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : String(r.display_name ?? "");
}

/**
 * The address nearest to a position, or null when there is none or the lookup fails.
 * Positions are rounded to about 11 m and cached for 30 days, so a parked vehicle costs one lookup.
 */
export async function reverseGeocode(latitude: number, longitude: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const lat = latitude.toFixed(4);
  const lon = longitude.toFixed(4);
  const cacheKey = `geocode:rev:v1:${lat},${lon}`;
  try {
    const cached = await (await getReadyRedisPublisher()).get(cacheKey);
    if (cached !== null) return cached || null;
  } catch {
    // cache is optional
  }

  await waitForSlot();
  let address: string | null = null;
  try {
    const url = `${REVERSE_ENDPOINT}?${new URLSearchParams({ lat, lon, format: "jsonv2", zoom: "18", addressdetails: "1" })}`;
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      logger.warn("geocode.reverse_http_error", { status: res.status });
      return null;
    }
    const row = (await res.json()) as NominatimRow & { error?: string };
    address = row.error ? null : streetAddress(row) || null;
  } catch (err) {
    logger.warn("geocode.reverse_failed", {}, err);
    return null;
  }
  try {
    await (await getReadyRedisPublisher()).set(cacheKey, address ?? "", "EX", REVERSE_CACHE_SECONDS);
  } catch {
    // ignore
  }
  return address;
}
