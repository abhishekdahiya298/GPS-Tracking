import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving. No dependency checks (see /api/health/ready). */
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "rio-gps-web", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
