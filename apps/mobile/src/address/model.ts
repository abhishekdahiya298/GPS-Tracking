/** Pure helpers for showing the street address of a position. No React Native imports. */

/** Positions closer than about 100 m share one lookup, so a vehicle crawling in a yard asks once. */
export const addressKey = (latitude: number, longitude: number): string => `${latitude.toFixed(3)},${longitude.toFixed(3)}`;

/** A small memory of looked-up addresses. The oldest entries are dropped past the limit. */
export function createAddressCache(limit = 300) {
  const known = new Map<string, string | null>();
  return {
    has: (key: string) => known.has(key),
    get: (key: string) => known.get(key) ?? null,
    set(key: string, value: string | null) {
      known.delete(key);
      known.set(key, value);
      if (known.size > limit) known.delete(known.keys().next().value as string);
    },
    size: () => known.size
  };
}
