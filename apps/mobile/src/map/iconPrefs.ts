import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_PREFS, type IconColor, type IconPrefs, type IconStyle } from "./model";

/** How vehicles are drawn on the maps: chosen in Account, kept on this phone. */
const KEY = "rio.mapIcons";
const STYLES: IconStyle[] = ["pin", "circle", "square", "top"];
const COLORS: IconColor[] = ["status", "type"];

function read(): IconPrefs {
  try {
    const raw = SecureStore.getItem(KEY);
    if (!raw) return DEFAULT_ICON_PREFS;
    const v = JSON.parse(raw) as Partial<IconPrefs>;
    return { style: STYLES.includes(v.style as IconStyle) ? (v.style as IconStyle) : DEFAULT_ICON_PREFS.style, color: COLORS.includes(v.color as IconColor) ? (v.color as IconColor) : DEFAULT_ICON_PREFS.color };
  } catch {
    return DEFAULT_ICON_PREFS;
  }
}

let current: IconPrefs = read();
const listeners = new Set<() => void>();

export function setIconPrefs(next: Partial<IconPrefs>): void {
  current = { ...current, ...next };
  try {
    SecureStore.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: the choice still applies until the app closes.
  }
  listeners.forEach((l) => l());
}

/** The current map icon choice; screens redraw when it changes. */
export function useIconPrefs(): IconPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
