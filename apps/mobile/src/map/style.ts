/** The base map the person picked on the map. When nothing is saved the map follows the look of the app. */
import * as SecureStore from "expo-secure-store";
import { isMapStyleId, type MapStyleId } from "./model";

const STYLE_KEY = "rio.map-style";

export async function savedMapStyle(): Promise<MapStyleId | null> {
  try {
    const saved = await SecureStore.getItemAsync(STYLE_KEY);
    return isMapStyleId(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveMapStyle(id: MapStyleId): void {
  SecureStore.setItemAsync(STYLE_KEY, id).catch(() => undefined);
}

/** Called when the look of the app changes: the map follows the new look again. */
export function forgetMapStyle(): void {
  SecureStore.deleteItemAsync(STYLE_KEY).catch(() => undefined);
}
