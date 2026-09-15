import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "rio-gps-web", timestamp: new Date().toISOString() });
}
