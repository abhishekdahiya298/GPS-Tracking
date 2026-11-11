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

/** Saves the look for the next start. The caller restarts the app so every screen picks it up. */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    SecureStore.setItem(THEME_KEY, choice);
  } catch {
    // Storage is unavailable: the phone's own setting keeps applying.
  }
}

/**
 * The look is decided once, when the app starts: every screen builds its styles from `colors`
 * at that moment. Changing it in Account restarts the app, which takes well under a second.
 */
export const themeChoice: ThemeChoice = readChoice();
export const isDark = themeChoice === "system" ? Appearance.getColorScheme() === "dark" : themeChoice === "dark";
export const colors = isDark ? dark : light;

/** Brighter twins of the fixed status and alert colours, for dark surfaces. */
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
export const type = {
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
} satisfies Record<string, TextStyle>;

/** Soft shadows, lightest first. Spread into a style. Cards use a hairline border instead. */
export const elevation = {
  sm: { shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: "#0f172a", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  lg: { shadowColor: "#0f172a", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 }
} as const;

/** Animation timings in ms. Keep motion short: it should explain, never delay. */
export const motion = { fast: 140, base: 240, slow: 380, stagger: 45, maxStagger: 8 } as const;
