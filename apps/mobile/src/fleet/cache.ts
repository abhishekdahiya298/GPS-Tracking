import AsyncStorage from "@react-native-async-storage/async-storage";
import { decodeCache, encodeCache } from "./cacheModel";
import type { FleetDevice } from "./model";

const KEY = "rio.fleet-cache";

/** The fleet as last shown on this phone, or null. Never throws. */
export async function loadFleetCache(): Promise<{ devices: FleetDevice[]; savedAt: number } | null> {
  try {
    return decodeCache(await AsyncStorage.getItem(KEY), Date.now());
  } catch {
    return null;
  }
}

export function saveFleetCache(devices: FleetDevice[]): void {
  if (devices.length === 0) return;
  AsyncStorage.setItem(KEY, encodeCache(devices, Date.now())).catch(() => undefined);
}

/** On sign-out: the next person on this phone must not see this fleet. */
export function clearFleetCache(): Promise<void> {
  return AsyncStorage.removeItem(KEY).catch(() => undefined);
}
