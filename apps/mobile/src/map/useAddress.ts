import { useEffect, useState } from "react";
import { api } from "@/api";

export interface StreetAddress {
  line1: string;
  line2: string | null;
  label: string;
}

const memo = new Map<string, StreetAddress | null>();

/**
 * Street address for a position, from the server (platform console → Maps & addresses), so the
 * phone needs no map key and the address matches the website. Rounded to ~11 m (~110 m while
 * moving) and remembered while the app runs; until it arrives, or with addresses off, screens
 * show the coordinates.
 */
export function useAddress(lat: number | null | undefined, lon: number | null | undefined, moving = false): StreetAddress | null {
  const digits = moving ? 3 : 4;
  const key = lat == null || lon == null ? null : `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
  const [value, setValue] = useState<StreetAddress | null>(key ? (memo.get(key) ?? null) : null);
  useEffect(() => {
    if (!key) {
      setValue(null);
      return;
    }
    if (memo.has(key)) {
      setValue(memo.get(key) ?? null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const [la, lo] = key.split(",");
      api
        .get<{ address: StreetAddress | null }>("geocode/reverse", { lat: la, lon: lo })
        .then((r) => {
          memo.set(key, r.address);
          if (live) setValue(r.address);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  return value;
}
