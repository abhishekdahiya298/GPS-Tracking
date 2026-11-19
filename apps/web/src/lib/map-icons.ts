"use client";
import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_PREFS, type IconColor, type IconPrefs, type IconStyle } from "@/app/(app)/map/fleet-model";

/** How vehicles are drawn on the maps. Kept in this browser, like the phone keeps its own. */
// v2: personal choices made before company map settings existed are dropped, so everyone starts from the company's.
const KEY = "rio.mapIcons.v2";
const STYLES: IconStyle[] = ["photo", "pin", "circle", "square", "top"];
const COLORS: IconColor[] = ["status", "type"];
const EVENT = "rio:map-icons";

let cached: IconPrefs | null = null;

/** The platform default (Platform console → Maps & addresses), put on <body data-map-icons="pin-status"> by the server. */
export function platformDefaultIcons(): IconPrefs {
  // The company's choice (Settings → Map display) first, then the platform default.
  const org = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-org-map-icons]")?.dataset.orgMapIcons;
  const [style, color] = (org ?? (typeof document === "undefined" ? "" : (document.body.dataset.mapIcons ?? ""))).split("-");
  return {
    style: STYLES.includes(style as IconStyle) ? (style as IconStyle) : DEFAULT_ICON_PREFS.style,
    color: COLORS.includes(color as IconColor) ? (color as IconColor) : DEFAULT_ICON_PREFS.color
  };
}

/** Whether this person picked their own icons in this browser (else the platform default applies). */
export function hasOwnMapIcons(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function readMapIcons(): IconPrefs {
  if (cached) return cached;
  const base = platformDefaultIcons();
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<IconPrefs>;
    cached = {
      style: STYLES.includes(v.style as IconStyle) ? (v.style as IconStyle) : base.style,
      color: COLORS.includes(v.color as IconColor) ? (v.color as IconColor) : base.color
    };
  } catch {
    cached = base;
  }
  return cached;
}

/** Back to the platform default. */
export function resetMapIcons(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  cached = null;
  window.dispatchEvent(new Event(EVENT));
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

/** After the company changes its map icons: maps re-read the company default (unless this person picked their own). */
export function refreshCompanyIcons(): void {
  cached = null;
  window.dispatchEvent(new Event(EVENT));
}
