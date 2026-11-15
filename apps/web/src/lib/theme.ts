/**
 * The website's light or dark look. The choice lives in a cookie so the server can put it on
 * <html data-theme> before the page is drawn: no flash, and no inline script (the strict CSP
 * would block one). "system" leaves the attribute off and the browser's setting decides.
 */
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_COOKIE = "rio-theme";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

export function readTheme(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** Saves the choice for a year and applies it to the open page at once. Browser only. */
export function applyTheme(choice: ThemeChoice): void {
  document.cookie = `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}
