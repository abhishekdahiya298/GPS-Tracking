/**
 * Design tokens for the app: colours, type, spacing, sizes, shadows and motion timings.
 * Every screen reads from here, so a change made here shows everywhere.
 */
import * as SecureStore from "expo-secure-store";
import { Appearance, StyleSheet, type TextStyle } from "react-native";

const light = {
  background: "#ffffff",
  canvas: "#e4e9f1",
  foreground: "#0f172a",
  muted: "#e6ebf2",
  mutedForeground: "#3f4b5e",
  border: "#cbd4e1",
  /** Outlines of inputs and outline buttons: strong enough to be seen on white. */
  borderStrong: "#7a8599",
  primary: "#1d4ed8",
  primaryDark: "#1e3a8a",
  primaryForeground: "#ffffff",
  primarySoft: "#dde7fb",
  success: "#0f5c2c",
  successSoft: "#b4e0c2",
  warning: "#b45309",
  warningSoft: "#fdebcf",
  danger: "#c42b2b",
  dangerSoft: "#f4bcbc",
  info: "#0369a1",
  offline: "#414b59"
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

/** Saves the look so the next start opens with it too. */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    SecureStore.setItem(THEME_KEY, choice);
  } catch {
    // Storage is unavailable: the phone's own setting keeps applying.
  }
}

const resolve = (choice: ThemeChoice, scheme = Appearance.getColorScheme()): boolean => (choice === "system" ? scheme === "dark" : choice === "dark");

/**
 * The look in use. These are live: switching the look (Account, or the phone going dark) swaps the
 * palette in place, rebuilds every screen's styles (see `themed`) and redraws the app at once, with
 * no restart. Read them during render or inside `themed`, never copy them into module constants.
 */
export let themeChoice: ThemeChoice = readChoice();
export let isDark = resolve(themeChoice);
export const colors: typeof light = { ...(isDark ? dark : light) };

/** Brighter twins of the fixed status and alert colours, for dark surfaces. */
const BRIGHT: Record<string, string> = {
  "#0f5c2c": "#4ade80",
  "#8f3d06": "#fb923c",
  "#9c1818": "#f87171",
  "#5a1fc0": "#a78bfa",
  "#b45309": "#fbbf24",
  "#0369a1": "#38bdf8",
  "#414b59": "#9ca3af",
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
const buildType = () =>
  ({
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
}) satisfies Record<string, TextStyle>;
export const type = buildType();

/** Soft shadows, lightest first. Spread into a style. Cards use a hairline border instead. */
export const elevation = {
  sm: { shadowColor: "#0f172a", shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: "#0f172a", shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  lg: { shadowColor: "#0f172a", shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 }
} as const;

/** Animation timings in ms. Keep motion short: it should explain, never delay. */
export const motion = { fast: 140, base: 240, slow: 380, stagger: 45, maxStagger: 8 } as const;

/* ---------- Switching the look without a restart ---------- */

type Sheet = Record<string, unknown>;
const sheets: { make: () => Sheet; sheet: Sheet }[] = [];
const listeners = new Set<() => void>();
let version = 0;

/**
 * A screen's styles, built from the current look and rebuilt when it changes. Use in place of
 * StyleSheet.create: `const styles = themed(() => ({ card: { backgroundColor: colors.background } }))`.
 */
export function themed<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>>(make: () => T & StyleSheet.NamedStyles<unknown>): T {
  const sheet = StyleSheet.create(make()) as unknown as Sheet;
  sheets.push({ make: make as () => Sheet, sheet });
  return sheet as unknown as T;
}

/** Changes the look now: palette, text styles and every screen's styles, then redraws the app. */
export function applyLook(choice: ThemeChoice, scheme = Appearance.getColorScheme()): void {
  themeChoice = choice;
  const dark_ = resolve(choice, scheme);
  if (dark_ === isDark) return;
  isDark = dark_;
  Object.assign(colors, dark_ ? dark : light);
  Object.assign(type, buildType());
  for (const { make, sheet } of sheets) Object.assign(sheet, StyleSheet.create(make() as StyleSheet.NamedStyles<unknown>));
  version += 1;
  listeners.forEach((l) => l());
}

/** Subscribe to look changes (the root uses this to redraw everything). */
export function onLookChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const lookVersion = (): number => version;
