/**
 * The street address of a position, looked up on the server and remembered.
 * Returns null while it is loading, when there is no address, or when the server has no lookup.
 */
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { addressKey, createAddressCache } from "./model";

const cache = createAddressCache();
const waiting = new Map<string, Promise<string | null>>();
// A server without the lookup (an older deployment) is asked only once.
let unavailable = false;

function lookup(key: string, latitude: number, longitude: number): Promise<string | null> {
  const running = waiting.get(key);
  if (running) return running;
  const request = api
    .get<{ address?: string | null }>("geocode/reverse", { lat: latitude.toFixed(4), lon: longitude.toFixed(4) })
    .then((body) => {
      const address = typeof body.address === "string" && body.address.trim() ? body.address.trim() : null;
      cache.set(key, address);
      return address;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && (error.kind === "not_found" || error.kind === "forbidden")) unavailable = true;
      return null;
    })
    .finally(() => waiting.delete(key));
  waiting.set(key, request);
  return request;
}

export function useAddress(latitude: number | null | undefined, longitude: number | null | undefined): string | null {
  const valid = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude);
  const key = valid ? addressKey(latitude, longitude) : null;
  const [address, setAddress] = useState<string | null>(key ? cache.get(key) : null);

  useEffect(() => {
    if (!key || !valid) {
      setAddress(null);
      return;
    }
    if (cache.has(key)) {
      setAddress(cache.get(key));
      return;
    }
    if (unavailable) return;
    let current = true;
    // A short wait, so stepping quickly through vehicles does not look up every one.
    const timer = setTimeout(() => {
      void lookup(key, latitude, longitude).then((found) => {
        if (current) setAddress(found);
      });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The key stands for the position: nearby positions share one lookup.
  }, [key]);

  return address;
}
