"use client";
import { useEffect, useState, type ComponentType } from "react";

/** Loads the tracking view (and MapLibre) in the browser only; see share-loader for why. */
export function TrackLoader() {
  const [View, setView] = useState<ComponentType | null>(null);
  useEffect(() => {
    let live = true;
    void import("./track-view").then((m) => live && setView(() => m.TrackView));
    return () => {
      live = false;
    };
  }, []);
  if (View) return <View />;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <p className="m-0 text-sm text-muted-foreground" role="status">
        Loading shipment…
      </p>
    </main>
  );
}
