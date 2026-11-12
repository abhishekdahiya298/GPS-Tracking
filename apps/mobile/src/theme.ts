/**
 * Design tokens for the app: colours, type, spacing, sizes, shadows and motion timings.
 * Every screen reads from here, so a change made here shows everywhere.
 */
import * as SecureStore from "expo-secure-store";
import { Appearance, type TextStyle } from "react-native";

const light = {
  background: "#ffffff",
  canvas: "#f5f7fb",
  foreground: "#0f172a",
  muted: "#eef2f7",
  mutedForeground: "#55607a",
  border: "#e3e8f0",
  /** Outlines of inputs and outline buttons: strong enough to be seen on white. */
  borderStrong: "#8a94a8",
  primary: "#1d4ed8",
  primaryDark: "#1e3a8a",
  primaryForeground: "#ffffff",
  primarySoft: "#eaf1ff",
  success: "#15803d",
  successSoft: "#e9f7ee",
  warning: "#b45309",
  warningSoft: "#fff5e1",
  danger: "#c42b2b",
  dangerSoft: "#fdecec",
  info: "#0369a1",
  offline: "#6b7280"
};

/** Dark palette. Status colours are brighter so they stay readable on a dark surface. */
const dark: typeof light = {
  background: "#161b24",
  canvas: "#0d1117",
  foreground: "#f1f3f6",
  muted: "#222a36",
  mutedForeground: "#9aa4b2",
  border: "#2c3543",
  borderStrong: "#5a6577",
  primary: "#4f7df3",
  primaryDark: "#0a2463",
  primaryForeground: "#ffffff",
  primarySoft: "#1b2a4e",
  success: "#4ade80",
  successSoft: "#12301f",
  warning: "#fbbf24",
  warningSoft: "#3a2a0a",
  danger: "#f87171",
  dangerSoft: "#3b1414",
  info: "#38bdf8",
  offline: "#8b95a5"
};

/** The look chosen in Account: follow the phone, or always light or dark. */
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "rio.theme";

function readChoice(): ThemeChoice {
  try {
    const saved = SecureStore.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function store(choice: ThemeChoice): void {
  try {
    SecureStore.setItem(THEME_KEY, choice);
  } catch {
    // Storage is unavailable: the phone's own setting keeps applying.
  }
}

const resolveDark = (choice: ThemeChoice): boolean => (choice === "system" ? Appearance.getColorScheme() === "dark" : choice === "dark");

/**
 * The look can change while the app is open. `colors`, `type` and every screen's styles read
 * the palette in use at the moment they are asked, and the app redraws when it changes, so
 * there is no restart and no blank screen.
 */
export let themeChoice: ThemeChoice = readChoice();
export let isDark = resolveDark(themeChoice);
let palette = isDark ? dark : light;
let version = 0;
const listeners = new Set<() => void>();

/** The colours of the look in use. Always current: read them when drawing, don't copy them. */
export const colors: typeof light = new Proxy(light, { get: (_, key) => palette[key as keyof typeof light] });

/** Counts up each time the look changes. */
export const themeVersion = (): number => version;
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function apply(): void {
  const next = resolveDark(themeChoice);
  if (next === isDark) return;
  isDark = next;
  palette = next ? dark : light;
  version++;
  listeners.forEach((l) => l());
}

/** Picks the look, saves it for the next start and redraws the app in it. */
export function setThemeChoice(choice: ThemeChoice): void {
  themeChoice = choice;
  store(choice);
  // The phone's own pieces follow too: keyboard, alerts, pickers.
  try {
    Appearance.setColorScheme(choice === "system" ? "unspecified" : choice);
  } catch {
    // Not supported on this platform.
  }
  apply();
}

/** The canvas colour a look would have, for the short fade while the look changes. */
export const canvasOf = (choice: ThemeChoice): string => (resolveDark(choice) ? dark : light).canvas;

// "System": follow the phone when it switches between light and dark.
Appearance.addChangeListener(() => {
  if (themeChoice === "system") apply();
});

/**
 * Styles that follow the look. Wrap a StyleSheet in this: it is built on first use and built
 * again after the look changes.
 */
export function themed<T extends object>(make: () => T): T {
  let built: T | null = null;
  let builtFor = -1;
  const current = (): T => {
    if (!built || builtFor !== version) {
      built = make();
      builtFor = version;
    }
    return built;
  };
  return new Proxy({} as T, {
    get: (_, key) => current()[key as keyof T],
    has: (_, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    }
  });
}

/** Brighter twins of the fixed status and alert colours, for dark surfaces. */
/** A colour group: the two ends of a gradient, the glow under it and the pale tint. Used by the colourful tiles and the 3D icons. */
export interface Tone { from: string; to: string; glow: string }
export const tones = {
  green: { from: "#34d399", to: "#059669", glow: "#059669" },
  amber: { from: "#fbbf24", to: "#ea580c", glow: "#ea580c" },
  blue: { from: "#60a5fa", to: "#1d4ed8", glow: "#1d4ed8" },
  sky: { from: "#38bdf8", to: "#0369a1", glow: "#0369a1" },
  red: { from: "#fb7185", to: "#dc2626", glow: "#dc2626" },
  slate: { from: "#94a3b8", to: "#475569", glow: "#475569" },
  violet: { from: "#a78bfa", to: "#6d28d9", glow: "#6d28d9" },
  teal: { from: "#2dd4bf", to: "#0f766e", glow: "#0f766e" }
} as const satisfies Record<string, Tone>;
export type ToneName = keyof typeof tones;

const BRIGHT: Record<string, string> = {
  "#15803d": "#4ade80",
  "#b45309": "#fbbf24",
  "#0369a1": "#38bdf8",
  "#6b7280": "#9ca3af",
  "#5b6472": "#9ca3af",
  "#c42b2b": "#f87171",
  "#1d4ed8": "#8fb0ff"
};
/** A status or alert colour as text or icon colour on the current surface. */
export const ink = (color: string): string => (isDark ? (BRIGHT[color.toLowerCase()] ?? color) : color);
/** The pale background that goes with a status or alert colour. */
export const softTint = (color: string, lightSoft: string): string => (isDark ? `${ink(color)}26` : lightSoft);

export const radius = { sm: 6, md: 10, lg: 12, xl: 14 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { caption: 12, small: 13, body: 15, title: 17, heading: 24 } as const;

/**
 * Standard sizes, the same on every screen. Anything a finger presses is at least 44 high.
 * control: buttons and text fields. row: one line of a list. well: the tinted square behind an icon.
 */
export const size = { control: 48, controlSm: 44, row: 60, well: 40, chip: 36, icon: 20, tabIcon: 24 } as const;

/** Text styles. Use these instead of writing font sizes on a screen. */
export const type = themed(() => ({
  /** The title at the top of a tab. One per screen. */
  largeTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground },
  /** A card or section heading. */
  title: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: colors.foreground },
  section: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: colors.foreground },
  /** The first line of a list row. */
  rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.foreground },
  body: { fontSize: 15, lineHeight: 22, color: colors.foreground },
  small: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  caption: { fontSize: 12, lineHeight: 16, color: colors.mutedForeground },
  /** Small capitals above a group of rows. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.7, textTransform: "uppercase", color: colors.mutedForeground },
  /** Big numbers: counts and readings. Digits keep the same width so they don't jump. */
  metric: { fontSize: 22, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground, fontVariant: ["tabular-nums"] }
}) satisfies Record<string, TextStyle>);

/** Soft shadows, lightest first. Spread into a style. Cards use a hairline border instead. */
export const elevation = {
  sm: { shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: "#0f172a", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  lg: { shadowColor: "#0f172a", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 }
} as const;

/** Animation timings in ms. Keep motion short: it should explain, never delay. */
export const motion = { fast: 140, base: 240, slow: 380, stagger: 45, maxStagger: 8 } as const;
