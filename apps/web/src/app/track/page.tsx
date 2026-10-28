import type { Metadata } from "next";
import { TrackLoader } from "./track-loader";

export const dynamic = "force-dynamic";

// Never indexed, and no Referer (map tiles come from another origin). The link's secret is in
// the URL fragment, which is not part of any request.
export const metadata: Metadata = {
  title: "Shipment tracking · RIO GPS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

/** Public page (no session). All data comes from POST /api/track/view with the token. */
export default function TrackPage() {
  return <TrackLoader />;
}
