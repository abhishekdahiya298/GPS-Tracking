/**
 * Content-Security-Policy for HTML pages (set per request by middleware.ts).
 * Scripts: only Next's own, authorised by a per-request nonce ('strict-dynamic'
 * lets those load their chunks) — no inline or third-party script can run.
 * Map: MapLibre fetches the OpenFreeMap style, tiles, glyphs and sprites
 * (connect-src/img-src) and runs its renderer in a blob: worker.
 */
export const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";

export function buildCsp(nonce: string, isDev = process.env.NODE_ENV !== "production"): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // React style props and MapLibre's inline element styles need inline styles.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", MAP_TILE_ORIGIN],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", MAP_TILE_ORIGIN],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(isDev ? {} : { "upgrade-insecure-requests": [] })
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
