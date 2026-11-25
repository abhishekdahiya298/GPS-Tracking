"use client";
import { Truck } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import "maplibre-gl/dist/maplibre-gl.css";
/**
 * Public share page: one vehicle's current position, refreshed every 15 seconds.
 * The token is read from the URL fragment (#…), which browsers never send to servers,
 * and posted to /api/share/view. Nothing else about the fleet is requested or shown.
 */
import { units } from "@rio-gps/core/units";
import { dateFormatter } from "@rio-gps/core/timezones";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { preferredStyleUrl } from "@/lib/map-style";
import { useEffect, useRef, useState } from "react";
import type { PublicShareView } from "@/lib/share-links";

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
    const m = new maplibregl.Map({ container: mapDiv.current, style: preferredStyleUrl(), center: [loc!.longitude, loc!.latitude], zoom: 13, attributionControl: { compact: true } });
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
  const state3 = !loc ? "none" : moving ? "moving" : "stopped";
  const chip = { moving: { label: `Moving · ${loc ? u.fmtSpeed(loc.speedKph) : ""}`, color: "#15803d" }, stopped: { label: loc?.ignition === true ? "Stopped · engine on" : "Stopped", color: "#b91c1c" }, none: { label: "Waiting", color: "#475569" } }[state3];
  return (
    <div className="relative h-dvh bg-canvas">
      <main className="absolute inset-0">
        {loc ? (
          // maplibre's CSS sets position:relative on the map element, so size it via a wrapper.
          <div className="absolute inset-0">
            <div ref={mapDiv} className="h-full w-full" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The vehicle hasn&apos;t reported a position yet. This page updates by itself.</div>
        )}
      </main>
      <section aria-live="polite" className="absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-2xl border border-border bg-background/95 p-4 shadow-pop backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: `linear-gradient(150deg, ${chip.color}cc, ${chip.color})` }}>
            <Truck className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-[17px] font-semibold text-[#0a2463] dark:text-foreground">{view.vehicleName}</h1>
            <p className="m-0 truncate text-xs text-muted-foreground">Shared live location</p>
          </div>
          <span className="inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold" style={{ color: chip.color, background: `color-mix(in srgb, ${chip.color} 12%, transparent)` }}>
            {chip.label}
          </span>
        </div>
        {loc && (
          <p className="m-0 mt-2.5 text-sm">
            Position from {ago(now - Date.parse(loc.recordedAt))} <span className="text-muted-foreground">({f.time(loc.recordedAt)} {f.abbr(loc.recordedAt)})</span>
          </p>
        )}
        <p className="m-0 mt-2 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span>
            Live location · link expires {f.dateTime(view.expiresAt)} {f.abbr(view.expiresAt)}
          </span>
          <BrandMark className="h-5" />
        </p>
      </section>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 flex justify-center">
        <BrandMark className="h-10" />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-card">{children}</div>
    </main>
  );
}
