import { cleanAddress, waitForSlot, type NominatimRow } from "./geocode";
import { logger } from "./logger";
import { getMapsSettings, type AddressProvider } from "./maps-settings";
import { getReadyRedisPublisher } from "./redis";

/**
 * Street address for a tracker position, from the address service chosen in the platform console.
 * Best practice for cost and speed: positions are rounded to ~11 m and each spot is looked up once,
 * then kept 90 days in Redis (a miss is kept 1 day so a bad spot isn't asked again and again).
 * Any failure returns null and the screens show the coordinates instead: an address is a nicety,
 * never a reason for a page to break.
 */
export interface ReverseAddress {
  /** "100 Front Street West" (or the road / place name). */
  line1: string;
  /** "Toronto, ON M5J 1E3". */
  line2: string | null;
  /** Whole address on one line. */
  label: string;
}

const KEEP_SECONDS = 90 * 24 * 3600;
const MISS_SECONDS = 24 * 3600;
const USER_AGENT = "RIO GPS tracking (support@riogps.com)";

export const spotKey = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

/** Nominatim (OpenStreetMap): free, one request per second for the whole server. */
export function fromNominatim(r: NominatimRow & { address?: Record<string, string> }): ReverseAddress | null {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ") || a.road || a.amenity || a.building || a.neighbourhood || null;
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? a.county ?? null;
  const iso = a["ISO3166-2-lvl4"];
  const state = iso && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) ? iso.split("-")[1]! : (a.state ?? null);
  const line2 = [city, [state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const line1 = street ?? city ?? null;
  if (!line1) {
    const label = cleanAddress(r).label;
    return label ? { line1: label, line2: null, label } : null;
  }
  return { line1, line2: line1 === city ? [state, a.postcode].filter(Boolean).join(" ") || null : line2, label: [line1, line2].filter(Boolean).join(", ") };
}

interface GeoapifyRow {
  housenumber?: string;
  street?: string;
  name?: string;
  city?: string;
  town?: string;
  village?: string;
  state_code?: string;
  state?: string;
  postcode?: string;
  formatted?: string;
}
export function fromGeoapify(r: GeoapifyRow): ReverseAddress | null {
  const street = [r.housenumber, r.street].filter(Boolean).join(" ") || r.street || r.name || null;
  const city = r.city ?? r.town ?? r.village ?? null;
  const line2 = [city, [r.state_code ?? r.state, r.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const line1 = street ?? city;
  if (!line1) return r.formatted ? { line1: r.formatted, line2: null, label: r.formatted } : null;
  return { line1, line2, label: [line1, line2].filter(Boolean).join(", ") };
}

interface GoogleComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
export function fromGoogle(r: { formatted_address?: string; address_components?: GoogleComponent[] }): ReverseAddress | null {
  const c = (t: string, short = false) => {
    const x = r.address_components?.find((k) => k.types.includes(t));
    return x ? (short ? x.short_name : x.long_name) : null;
  };
  const street = [c("street_number"), c("route")].filter(Boolean).join(" ") || c("route") || null;
  const city = c("locality") ?? c("sublocality") ?? c("administrative_area_level_3") ?? null;
  const line2 = [city, [c("administrative_area_level_1", true), c("postal_code")].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const line1 = street ?? city;
  if (!line1) return r.formatted_address ? { line1: r.formatted_address, line2: null, label: r.formatted_address } : null;
  return { line1, line2, label: [line1, line2].filter(Boolean).join(", ") };
}

async function lookup(provider: Exclude<AddressProvider, "off">, lat: number, lon: number, fetchImpl: typeof fetch): Promise<ReverseAddress | null> {
  const signal = AbortSignal.timeout(6_000);
  if (provider === "osm") {
    await waitForSlot();
    const url = `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", addressdetails: "1", zoom: "18" })}`;
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, "accept-language": "en" }, signal });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const row = (await res.json()) as NominatimRow & { error?: string };
    return row.error ? null : fromNominatim(row);
  }
  if (provider === "geoapify") {
    const url = `https://api.geoapify.com/v1/geocode/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), format: "json", lang: "en", apiKey: process.env.RIO_GEOAPIFY_KEY ?? "" })}`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`geoapify ${res.status}`);
    const body = (await res.json()) as { results?: GeoapifyRow[] };
    return body.results?.[0] ? fromGeoapify(body.results[0]) : null;
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ latlng: `${lat},${lon}`, language: "en", key: process.env.RIO_GOOGLE_MAPS_KEY ?? "" })}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const body = (await res.json()) as { status?: string; results?: Array<{ formatted_address?: string; address_components?: GoogleComponent[] }> };
  if (body.status && body.status !== "OK" && body.status !== "ZERO_RESULTS") throw new Error(`google ${body.status}`);
  return body.results?.[0] ? fromGoogle(body.results[0]) : null;
}

export interface ReverseResult {
  address: ReverseAddress | null;
  provider: AddressProvider;
  /** The address of a spot within about 110 m (cached), not this exact spot. */
  approximate?: boolean;
  /** No answer yet (service busy or failing): ask again in this many seconds. */
  retryAfter?: number;
}

/** ~110 m cell: an address cached for any spot in it is good enough to show while moving or busy. */
export const nearKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;
const COOLDOWN_KEY = "revgeo:cooldown";

async function redisOrNull() {
  try {
    return await getReadyRedisPublisher();
  } catch {
    return null;
  }
}

/**
 * The address for a position.
 * Order: this spot (~11 m) → any spot within ~110 m → the address service. The service is called only
 * inside its rate limit (OpenStreetMap: one request a second for the whole server); when it is busy or
 * failing we answer `retryAfter` instead of breaking its rules, and the screen asks again shortly.
 */
export async function reverseGeocode(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<ReverseResult> {
  const { addressProvider: provider } = await getMapsSettings();
  if (provider === "off" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { address: null, provider };
  const key = `revgeo:v1:${provider}:${spotKey(lat, lon)}`;
  const near = `revgeo:near:v1:${provider}:${nearKey(lat, lon)}`;
  const redis = await redisOrNull();
  if (redis) {
    try {
      const [hit, nearHit, cooling] = await redis.mget(key, near, COOLDOWN_KEY);
      if (hit) return { address: hit === "-" ? null : (JSON.parse(hit) as ReverseAddress), provider };
      if (nearHit) return { address: JSON.parse(nearHit) as ReverseAddress, provider, approximate: true };
      if (cooling) return { address: null, provider, retryAfter: Math.max(5, Number(cooling) || 15) };
    } catch {
      // The cache is optional.
    }
  }
  if (provider === "osm" && !(await waitForSlot())) return { address: null, provider, retryAfter: 3 };
  let address: ReverseAddress | null = null;
  try {
    address = await lookup(provider, Number(lat.toFixed(5)), Number(lon.toFixed(5)), fetchImpl);
  } catch (err) {
    logger.warn("reverse_geocode.failed", { provider }, err);
    // Throttled or down: pause every lookup for a short while instead of hammering the service.
    const throttled = /\b(429|403|503|OVER_QUERY_LIMIT)\b/.test(String(err instanceof Error ? err.message : err));
    try {
      await redis?.set(COOLDOWN_KEY, throttled ? "60" : "10", "EX", throttled ? 60 : 10, "NX");
    } catch {
      // ignore
    }
    return { address: null, provider, retryAfter: throttled ? 60 : 10 };
  }
  try {
    if (redis) {
      const m = redis.multi().set(key, address ? JSON.stringify(address) : "-", "EX", address ? KEEP_SECONDS : MISS_SECONDS);
      if (address) m.set(near, JSON.stringify(address), "EX", KEEP_SECONDS);
      await m.exec();
    }
  } catch {
    // ignore
  }
  return { address, provider };
}
