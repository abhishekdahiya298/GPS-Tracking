"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export interface StreetAddress {
  line1: string;
  line2: string | null;
  label: string;
}

const memo = new Map<string, StreetAddress | null>();

/**
 * Street address for a position from the server (Maps & addresses in the platform console).
 * Rounded to ~11 m (~110 m while moving) and remembered for the page's life, so a moving truck asks again only when it
 * has actually moved; while it loads (or with addresses off) the screen shows coordinates.
 */
export function useAddress(lat: number | null, lon: number | null, moving = false): StreetAddress | null {
  // Moving: ~110 m steps, so a driving truck asks a few times a minute, not every update.
  const digits = moving ? 3 : 4;
  const key = lat === null || lon === null ? null : `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
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
      api<{ address: StreetAddress | null }>(`/api/geocode/reverse?lat=${la}&lon=${lo}`)
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
