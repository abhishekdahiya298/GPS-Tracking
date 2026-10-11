"use client";
import "maplibre-gl/dist/maplibre-gl.css";
/**
 * Public share page: one vehicle's current position, refreshed every 15 seconds.
 * The token is read from the URL fragment (#…), which browsers never send to servers,
 * and posted to /api/share/view. Nothing else about the fleet is requested or shown.
 */
import { units } from "@rio-gps/core/units";
import { dateFormatter } from "@rio-gps/core/timezones";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { PublicShareView } from "@/lib/share-links";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 15_000;
type State = { kind: "loading" } | { kind: "gone" } | { kind: "error"; message: string } | { kind: "ok"; view: PublicShareView; fetchedAt: number };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function ShareView() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const centered = useRef(false);

  // Fetch + poll. Stops for good once the link is gone; pauses while the tab is hidden.
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState({ kind: "gone" });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(load, POLL_MS);
        return;
      }
      try {
        const res = await fetch("/api/share/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store", referrerPolicy: "no-referrer" });
        if (stopped) return;
        if (res.status === 404) {
          stopped = true;
          setState({ kind: "gone" });
          return;
        }
        if (!res.ok) throw new Error(res.status === 429 ? "Too many requests. Retrying shortly." : `Could not refresh (${res.status}). Retrying.`);
        setState({ kind: "ok", view: (await res.json()) as PublicShareView, fetchedAt: Date.now() });
      } catch (err) {
        // Keep showing the last known position; only a first-load failure replaces the page.
        setState((s) => (s.kind === "ok" ? s : { kind: "error", message: err instanceof Error ? err.message : "Could not load this link." }));
      }
      timer = setTimeout(load, POLL_MS);
    };
    void load();
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  const loc = state.kind === "ok" ? state.view.location : null;
  const hasMap = state.kind === "ok" && loc !== null;

  // Map: created once there is a position; one marker, moved on each refresh.
  useEffect(() => {
    if (!hasMap || !mapDiv.current || map.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: [loc!.longitude, loc!.latitude], zoom: 13, attributionControl: { compact: true } });
    m.getCanvas().setAttribute("aria-label", "Map showing the vehicle's current position");
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.current = m;
    return () => {
      marker.current = null;
      map.current = null;
      centered.current = false;
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMap]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loc) return;
    const ll: [number, number] = [loc.longitude, loc.latitude];
    if (!marker.current) {
      const el = document.createElement("div");
      el.className = "size-5 rounded-full border-[3px] border-white bg-primary shadow-[0_0_0_2px_rgba(47,91,234,0.35),0_2px_6px_rgba(0,0,0,0.35)]";
      marker.current = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(m);
    } else marker.current.setLngLat(ll);
    // Follow the vehicle, but don't fight someone who has panned away to look around.
    if (!centered.current || m.getBounds().contains(ll)) m.easeTo({ center: ll, duration: centered.current ? 800 : 0 });
    centered.current = true;
  }, [loc]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <p className="m-0 text-sm text-muted-foreground" role="status">
          Loading the shared location…
        </p>
      </Shell>
    );
  }
  if (state.kind === "gone") {
    return (
      <Shell>
        <h1 className="m-0 text-lg font-semibold">This link is not available</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground">It may have expired or been turned off. Ask the person who sent it for a new link.</p>
      </Shell>
    );
  }
  if (state.kind === "error") {
    return (
      <Shell>
        <h1 className="m-0 text-lg font-semibold">Could not load this link</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground" role="alert">
          {state.message}
        </p>
      </Shell>
    );
  }

  const { view } = state;
  const u = units(view.unitSystem);
  const f = dateFormatter(view.timeZone, view.timeFormat);
  const moving = loc !== null && (loc.speedKph ?? 0) >= 5;
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true" className="flex size-5 items-center justify-center rounded bg-primary text-[11px] font-bold text-white">
              R
            </span>
            RIO GPS · shared location
          </p>
          <h1 className="m-0 mt-0.5 truncate text-lg font-semibold">{view.vehicleName}</h1>
        </div>
        <div className="text-sm" aria-live="polite">
          {loc ? (
            <>
              <span className="font-medium">{moving ? `Moving · ${u.fmtSpeed(loc.speedKph)}` : loc.ignition === true ? "Stopped · engine on" : "Stopped"}</span>
              <span className="text-muted-foreground">
                {" "}
                · position from {ago(now - Date.parse(loc.recordedAt))} ({f.time(loc.recordedAt)} {f.abbr(loc.recordedAt)})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No position yet. This page updates by itself.</span>
          )}
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {loc ? (
          // maplibre's CSS sets position:relative on the map element, so size it via a wrapper.
          <div className="absolute inset-0">
            <div ref={mapDiv} className="h-full w-full" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The vehicle hasn&apos;t reported a position yet.</div>
        )}
      </main>
      <footer className="shrink-0 border-t border-border bg-background px-4 py-2 text-xs text-muted-foreground">
        Updates every 15 seconds · link expires {f.dateTime(view.expiresAt)} {f.abbr(view.expiresAt)}
      </footer>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
          R
        </span>
        RIO GPS
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-card">{children}</div>
    </main>
  );
}
