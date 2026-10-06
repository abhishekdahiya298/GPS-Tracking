"use client";
import { useEffect, useState, type ComponentType } from "react";

/**
 * Loads the share view (and MapLibre) only in the browser. A plain dynamic import after
 * mount, rather than next/dynamic, so the server-rendered HTML contains no preload tag
 * without a nonce (the Content-Security-Policy would block it).
 */
export function ShareLoader() {
  const [View, setView] = useState<ComponentType | null>(null);
  useEffect(() => {
    let live = true;
    void import("./share-view").then((m) => live && setView(() => m.ShareView));
    return () => {
      live = false;
    };
  }, []);
  if (View) return <View />;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <p className="m-0 text-sm text-muted-foreground" role="status">
        Loading the shared location…
      </p>
    </main>
  );
}
