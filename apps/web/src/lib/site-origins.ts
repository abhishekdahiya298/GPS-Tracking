/**
 * Origins of the public marketing site (a separate project) that may post pricing
 * requests to POST /api/leads from the browser. Nothing else is opened cross-origin:
 * that endpoint is public, unauthenticated, rate-limited and never reads cookies.
 *
 * Add the site's address here, or set PUBLIC_SITE_ORIGINS (comma-separated) to override.
 */
const DEFAULT_SITE_ORIGINS: string[] = [];

export function publicSiteOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.PUBLIC_SITE_ORIGINS?.trim();
  const list = raw ? raw.split(",") : DEFAULT_SITE_ORIGINS;
  const out: string[] = [];
  for (const item of list) {
    try {
      const u = new URL(item.trim());
      // An origin only: https (or http on localhost for development), no path.
      if (u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost")) out.push(u.origin);
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}
