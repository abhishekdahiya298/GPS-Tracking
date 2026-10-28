import type { Metadata, Viewport } from "next";
import { DriverView } from "./driver-view";

export const dynamic = "force-dynamic";

// The driver's link: never indexed, no Referer. The secret is in the URL fragment (#…),
// which browsers never send to a server.
export const metadata: Metadata = {
  title: "Share your location · RIO GPS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a2463" };

/** Public page (no session). All data comes from /api/driver/* with the token. */
export default function DriverPage() {
  return <DriverView />;
}
