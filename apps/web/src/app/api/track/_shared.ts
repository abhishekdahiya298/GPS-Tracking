import { NextResponse } from "next/server";

export const PUBLIC_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

/** Unknown, malformed, replaced and revoked tokens all get this same answer. */
export const notAvailable = () => NextResponse.json({ error: { code: "NOT_AVAILABLE", message: "This link is not available." } }, { status: 404, headers: PUBLIC_HEADERS });
