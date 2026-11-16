import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_PREFS, type IconColor, type IconPrefs, type IconStyle } from "./model";

/** How vehicles are drawn on the maps: chosen in Account, kept on this phone. */
const KEY = "rio.mapIcons";
/** The platform default from the server (Platform console → Maps & addresses), remembered for offline starts. */
const DEFAULT_KEY = "rio.mapIconsDefault";
const STYLES: IconStyle[] = ["photo", "pin", "circle", "square", "top"];
const COLORS: IconColor[] = ["status", "type"];

function parse(raw: string | null, base: IconPrefs): IconPrefs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<IconPrefs>;
    return { style: STYLES.includes(v.style as IconStyle) ? (v.style as IconStyle) : base.style, color: COLORS.includes(v.color as IconColor) ? (v.color as IconColor) : base.color };
  } catch {
    return null;
  }
}
function readKey(key: string): string | null {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
}

let platformDefault: IconPrefs = parse(readKey(DEFAULT_KEY), DEFAULT_ICON_PREFS) ?? DEFAULT_ICON_PREFS;
let own: IconPrefs | null = parse(readKey(KEY), platformDefault);
let current: IconPrefs = own ?? platformDefault;
const listeners = new Set<() => void>();

export function setIconPrefs(next: Partial<IconPrefs>): void {
  own = { ...current, ...next };
  current = own;
  try {
    SecureStore.setItem(KEY, JSON.stringify(own));
  } catch {
    // Storage unavailable: the choice still applies until the app closes.
  }
  listeners.forEach((l) => l());
}

/** Whether this person picked their own icons on this phone (else the platform default applies). */
export const hasOwnIconPrefs = (): boolean => own !== null;

/** Back to the platform default. */
export function resetIconPrefs(): void {
  own = null;
  current = platformDefault;
  try {
    SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** The server's default arrived: use it unless the person chose their own. */
export function applyPlatformIconDefault(d: Partial<IconPrefs>): void {
  const next = parse(JSON.stringify(d), DEFAULT_ICON_PREFS) ?? DEFAULT_ICON_PREFS;
  if (next.style === platformDefault.style && next.color === platformDefault.color) return;
  platformDefault = next;
  try {
    SecureStore.setItem(DEFAULT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  if (!own) {
    current = next;
    listeners.forEach((l) => l());
  }
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
