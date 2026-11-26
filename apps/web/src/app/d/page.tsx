import type { Metadata, Viewport } from "next";
import { MapPin, Smartphone } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import { StoreBadges } from "@/components/app/store-badges";
import { storeLinks } from "@/lib/app-releases";

export const dynamic = "force-dynamic";

// Old driver links (before the driver app took over). Never indexed, no Referer.
export const metadata: Metadata = {
  title: "Your load is in the RIO GPS app",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a2463" };

/**
 * Loads are no longer tracked in the browser. A driver who opens an old link is sent to the
 * RIO GPS app, where loads sent to their number are waiting to accept.
 */
export default async function DriverLinkMoved() {
  const stores = await storeLinks();
  return (
    <main className="grid min-h-dvh place-items-center bg-[linear-gradient(160deg,#071a4a,#0a2463_45%,#1d4fb8)] px-5 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-pop">
        <div className="mb-5 flex justify-center">
          <BrandMark className="h-12" />
        </div>
        <h1 className="m-0 text-center text-2xl font-semibold tracking-tight text-[#0a2463] dark:text-foreground">Your load is in the RIO GPS app</h1>
        <p className="m-0 mt-2 text-center text-sm text-muted-foreground">Location for loads is shared from the app now, not from the browser. Sign in with your mobile number and accept the load there.</p>
        <a href="riogps://driver" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#1849c6,#0a2463)] text-[15px] font-semibold text-white no-underline shadow-pop">
          <Smartphone className="size-5" aria-hidden="true" /> Open the RIO GPS app
        </a>
        <p className="m-0 mt-5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">No app yet?</p>
        <div className="mt-2">
          <StoreBadges ios={stores.ios} android={stores.android} />
        </div>
        <p className="m-0 mt-5 flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> The company sees your location for this load only, and only after you accept. It stops when the load is delivered.
        </p>
      </div>
    </main>
  );
}
