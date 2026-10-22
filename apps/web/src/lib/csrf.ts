import { getServerEnv } from "./env";
import { ForbiddenError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for RIO's own cookie-authenticated mutating routes (Better Auth
 * endpoints already enforce trustedOrigins). Combined with SameSite=Lax session
 * cookies: a state-changing request must carry an Origin (or, failing that, a
 * Referer) that exactly matches AUTH_URL's origin (or one of AUTH_ALIAS_URLS). Missing both → rejected,
 * except for cookie-less bearer-token clients (see below).
 */
/** The app's own origins: AUTH_URL plus any alias addresses serving the same app. */
export function appOrigins(): string[] {
  const env = getServerEnv();
  return [env.AUTH_URL, ...env.AUTH_ALIAS_URLS].map((u) => new URL(u).origin);
}

export function assertSameOrigin(request: Request, allowed: string | string[] = appOrigins()): void {
  const allowedOrigins = Array.isArray(allowed) ? allowed : [allowed];
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  // Phones and other non-browser clients authenticate with "Authorization: Bearer …" and send
  // no cookies. CSRF needs a browser attaching cookies on its own, so such a request has
  // nothing to forge: allow it when it carries a bearer token, no Cookie and no Origin.
  // (A browser always sends Origin on a cross-site POST, so this cannot be used from a web page.)
  if (!origin && !request.headers.get("cookie") && !request.headers.get("referer") && /^bearer \S+/i.test(request.headers.get("authorization") ?? "")) return;
  if (origin) {
    if (allowedOrigins.includes(origin)) return;
    throw new ForbiddenError("Cross-origin request rejected");
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (allowedOrigins.includes(new URL(referer).origin)) return;
    } catch {
      // malformed referer falls through to rejection
    }
  }
  throw new ForbiddenError("Cross-origin request rejected");
}
