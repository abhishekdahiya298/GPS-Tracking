import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic page gate: bounces visitors without a session cookie to /login.
 * This is NOT the security boundary — every page and API route validates the
 * session server-side (lib/authz.ts). API routes are excluded so they answer
 * 401 JSON instead of redirecting.
 */
export function middleware(request: NextRequest) {
  const cookie = getSessionCookie(request, { cookiePrefix: "rio" });
  if (!cookie) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/map/:path*", "/vehicles/:path*", "/settings/:path*"]
};
