import { getServerEnv } from "./env";
import { ForbiddenError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for RIO's own cookie-authenticated mutating routes (Better Auth
 * endpoints already enforce trustedOrigins). Combined with SameSite=Lax session
 * cookies: a state-changing request must carry an Origin (or, failing that, a
 * Referer) that exactly matches AUTH_URL's origin. Missing both → rejected.
 */
export function assertSameOrigin(request: Request, allowedOrigin = new URL(getServerEnv().AUTH_URL).origin): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin === allowedOrigin) return;
    throw new ForbiddenError("Cross-origin request rejected");
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin === allowedOrigin) return;
    } catch {
      // malformed referer falls through to rejection
    }
  }
  throw new ForbiddenError("Cross-origin request rejected");
}
