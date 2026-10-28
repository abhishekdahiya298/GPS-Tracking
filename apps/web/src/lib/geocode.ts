import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";

/**
 * Address search for load stops, through OpenStreetMap's Nominatim. Nominatim's usage policy
 * allows at most one request per second with an identifying User-Agent, and asks that results
 * be cached; both are done here (a shared per-second slot and a 7-day cache in Redis).
 * Coordinates typed as "lat, lon" are answered directly without a lookup.
 */
export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "RIO GPS load tracking (support@riogps.com)";
const CACHE_SECONDS = 7 * 24 * 3600;

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

  const cacheKey = `geocode:v1:${query.toLowerCase()}`;
  try {
    const cached = await (await getReadyRedisPublisher()).get(cacheKey);
    if (cached) return JSON.parse(cached) as GeocodeResult[];
  } catch {
    // cache is optional
  }

  await waitForSlot();
  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "6", countrycodes: "us,ca,mx" })}`;
  let results: GeocodeResult[];
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      logger.warn("geocode.http_error", { status: res.status });
      return [];
    }
    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    results = rows
      .map((r) => ({ label: String(r.display_name ?? ""), latitude: Number(r.lat), longitude: Number(r.lon) }))
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
