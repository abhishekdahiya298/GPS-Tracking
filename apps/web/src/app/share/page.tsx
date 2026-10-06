import type { Metadata } from "next";
import { ShareLoader } from "./share-loader";

export const dynamic = "force-dynamic";

// Never indexed, and no Referer is sent from this page (map tiles are loaded from another
// origin). The link's secret is in the URL fragment, which is not part of any request.
export const metadata: Metadata = {
  title: "Shared location · RIO GPS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

/** Public page (no session). All data comes from POST /api/share/view with the token. */
export default function SharePage() {
  return <ShareLoader />;
}
