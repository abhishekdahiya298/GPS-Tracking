import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Which map the app draws, chosen by the platform admin (Platform console → Maps & addresses)
 * and read from the server at start, so it changes without a new app install.
 * - "osm": OpenStreetMap through MapLibre (free on every phone; the default).
 * - "native": the phone's own map: Apple Maps on iPhone (free, no key). Android uses Google Maps
 *   only when this build carries a Google Maps key; otherwise it stays on OpenStreetMap.
 * The last answer is remembered, so the app opens on the same map while offline.
 */
export type MapEngine = "osm" | "native";
const KEY = "rio.mapEngine";

const androidHasGoogleKey = Boolean((Constants.expoConfig?.android?.config as { googleMaps?: { apiKey?: string } } | undefined)?.googleMaps?.apiKey);
/** Whether "native" can actually be drawn on this phone. */
export const nativeMapAvailable = Platform.OS === "ios" || (Platform.OS === "android" && androidHasGoogleKey);

function read(): MapEngine {
  try {
    return SecureStore.getItem(KEY) === "native" ? "native" : "osm";
  } catch {
    return "osm";
  }
}

let chosen: MapEngine = read();
const listeners = new Set<() => void>();

export function applyMapEngine(value: unknown): void {
  const next: MapEngine = value === "native" ? "native" : "osm";
  if (next === chosen) return;
  chosen = next;
  try {
    SecureStore.setItem(KEY, next);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** The map to draw now: the admin's choice, falling back to OpenStreetMap where it can't be drawn. */
export function useMapEngine(): MapEngine {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chosen
  );
  return v === "native" && nativeMapAvailable ? "native" : "osm";
}
