import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

const PROTECTED = ["/dashboard", "/map", "/vehicles", "/settings", "/geofences", "/alerts", "/reports"];

/**
 * Runs on every HTML page (not API routes or static assets):
 * 1. Sets a per-request nonce-based Content-Security-Policy. Next reads the
 *    nonce from the request's CSP header and applies it to its own scripts.
 * 2. Optimistic page gate: bounces visitors without a session cookie away from
 *    protected pages. This is NOT the security boundary — every page and API
 *    route validates the session server-side (lib/authz.ts).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !getSessionCookie(request, { cookiePrefix: "rio" })) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
      // Prefetches don't render HTML; skip them.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
