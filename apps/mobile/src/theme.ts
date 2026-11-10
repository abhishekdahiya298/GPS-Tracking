/**
 * Design tokens, copied from the web app's globals.css so both look alike.
 * Change a value there and here together.
 */
import { Appearance } from "react-native";

const light = {
  background: "#ffffff",
  canvas: "#f6f7f9",
  foreground: "#111827",
  muted: "#f3f4f6",
  mutedForeground: "#5b6472",
  border: "#e3e6eb",
  primary: "#133a8f",
  primaryDark: "#0a2463",
  primaryForeground: "#ffffff",
  primarySoft: "#e9eefb",
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

/**
 * The app follows the phone's light or dark setting. It is read once, when the app starts:
 * every screen builds its styles from `colors` at that moment, so a change made while the
 * app is open takes effect the next time it is opened.
 */
export const isDark = Appearance.getColorScheme() === "dark";
export const colors = isDark ? dark : light;

/** Brighter twins of the fixed status and alert colours, for dark surfaces. */
const BRIGHT: Record<string, string> = {
  "#15803d": "#4ade80",
  "#b45309": "#fbbf24",
  "#0369a1": "#38bdf8",
  "#6b7280": "#9ca3af",
  "#5b6472": "#9ca3af",
  "#c42b2b": "#f87171",
  "#133a8f": "#8fb0ff"
};
/** A status or alert colour as text or icon colour on the current surface. */
export const ink = (color: string): string => (isDark ? (BRIGHT[color.toLowerCase()] ?? color) : color);
/** The pale background that goes with a status or alert colour. */
export const softTint = (color: string, lightSoft: string): string => (isDark ? `${ink(color)}26` : lightSoft);

export const radius = { sm: 4, md: 8, lg: 10, xl: 12 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { small: 13, body: 15, title: 18, heading: 24 } as const;

/** Brand gradient for headers and the sign-in screen (top-left to bottom-right). */
export const gradient = { brand: ["#0a2463", "#133a8f", "#1d4fc0"] as const, angle: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } } as const;

/** Soft shadows, lightest first. Spread into a style. */
export const elevation = {
  sm: { shadowColor: "#101828", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: "#101828", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  lg: { shadowColor: "#101828", shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 }
} as const;

/** Animation timings in ms. Keep motion short: it should explain, never delay. */
export const motion = { fast: 140, base: 240, slow: 380, stagger: 45, maxStagger: 8 } as const;
