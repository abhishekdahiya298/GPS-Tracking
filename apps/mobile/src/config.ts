/**
 * Where the app finds the server. Set EXPO_PUBLIC_API_URL to point a build at
 * another server (for example a laptop on the same Wi-Fi during development).
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://gps.riocaliforniainc.com").replace(/\/+$/, "");
