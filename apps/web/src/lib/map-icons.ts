"use client";
import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_PREFS, type IconColor, type IconPrefs, type IconStyle } from "@/app/(app)/map/fleet-model";

/** How vehicles are drawn on the maps. Kept in this browser, like the phone keeps its own. */
const KEY = "rio.mapIcons";
const STYLES: IconStyle[] = ["pin", "circle", "square", "top"];
const COLORS: IconColor[] = ["status", "type"];
const EVENT = "rio:map-icons";

let cached: IconPrefs | null = null;

export function readMapIcons(): IconPrefs {
  if (cached) return cached;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<IconPrefs>;
    cached = {
      style: STYLES.includes(v.style as IconStyle) ? (v.style as IconStyle) : DEFAULT_ICON_PREFS.style,
      color: COLORS.includes(v.color as IconColor) ? (v.color as IconColor) : DEFAULT_ICON_PREFS.color
    };
  } catch {
    cached = DEFAULT_ICON_PREFS;
  }
  return cached;
}

export function saveMapIcons(next: Partial<IconPrefs>): void {
  cached = { ...readMapIcons(), ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private browsing: the choice applies until the page closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The current choice; maps redraw when it changes (also from another tab). */
export function useMapIcons(): IconPrefs {
  return useSyncExternalStore(
    (cb) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          cached = null;
          cb();
        }
      };
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    readMapIcons,
    () => DEFAULT_ICON_PREFS
  );
}
