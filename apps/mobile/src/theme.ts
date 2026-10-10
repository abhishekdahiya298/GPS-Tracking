/**
 * Design tokens, copied from the web app's globals.css so both look alike.
 * Change a value there and here together.
 */
export const colors = {
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
} as const;

export const radius = { sm: 4, md: 8, lg: 10, xl: 12 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { small: 13, body: 15, title: 18, heading: 24 } as const;
