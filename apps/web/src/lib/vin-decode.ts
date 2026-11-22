import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";
import { FUEL_TYPES, normalizeVin, VIN_RE, vinCheckDigitOk } from "./schemas/vehicle";

/**
 * VIN look-up with the free US NHTSA vPIC service (no key). Fills year, make, model and
 * fuel for North American vehicles; anything it can't tell stays empty for the customer
 * to type. Results are cached for 30 days (a VIN never changes what it describes).
 */
export interface VinInfo {
  vin: string;
  modelYear: number | null;
  make: string | null;
  model: string | null;
  fuelType: (typeof FUEL_TYPES)[number] | null;
  /** False when position 9 doesn't match: a typo, or a non-North-American VIN. */
  checkDigitOk: boolean;
  found: boolean;
}

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const TTL = 30 * 24 * 3600;

function fuel(v: string | undefined): VinInfo["fuelType"] {
  const s = (v ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("diesel")) return "diesel";
  if (s.includes("gasoline")) return "gasoline";
  if (s.includes("electric") && s.includes("hybrid")) return "hybrid";
  if (s.includes("electric")) return "electric";
  if (s.includes("compressed natural gas") || s.includes("cng")) return "cng";
  if (s.includes("propane") || s.includes("lpg")) return "propane";
  return "other";
}

/** "FREIGHTLINER" → "Freightliner"; keeps short all-caps names like "BMW". */
function tidy(s: string | undefined) {
  const t = (s ?? "").trim();
  if (!t) return null;
  if (t.length <= 3) return t;
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : t;
}

export async function decodeVin(raw: string, fetchImpl: typeof fetch = fetch): Promise<VinInfo | null> {
  const vin = normalizeVin(raw);
  if (!VIN_RE.test(vin)) return null;
  const empty: VinInfo = { vin, modelYear: null, make: null, model: null, fuelType: null, checkDigitOk: vinCheckDigitOk(vin), found: false };
  const key = `vin:${vin}`;
  try {
    const cached = await (await getReadyRedisPublisher(500)).get(key);
    if (cached) return JSON.parse(cached) as VinInfo;
  } catch {
    /* no cache: look it up */
  }
  let info = empty;
  try {
    const res = await fetchImpl(`${VPIC}/${encodeURIComponent(vin)}?format=json`, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as { Results?: Record<string, string>[] };
      const r = body.Results?.[0] ?? {};
      const year = Number(r.ModelYear);
      info = {
        ...empty,
        modelYear: Number.isInteger(year) && year > 1950 ? year : null,
        make: tidy(r.Make),
        model: tidy(r.Model),
        fuelType: fuel(r.FuelTypePrimary)
      };
      info.found = Boolean(info.make || info.model || info.modelYear);
    }
  } catch (err) {
    logger.warn("vin.lookup_failed", {}, err);
    return empty;
  }
  try {
    await (await getReadyRedisPublisher(500)).set(key, JSON.stringify(info), "EX", info.found ? TTL : 3600);
  } catch {
    /* fine without cache */
  }
  return info;
}
