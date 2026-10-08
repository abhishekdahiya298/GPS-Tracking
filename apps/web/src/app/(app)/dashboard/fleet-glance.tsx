"use client";
/**
 * "Fleet at a glance": a small live map on the dashboard. It loads the map library and opens
 * the live stream only when the card scrolls into view, so the rest of the dashboard is not
 * slowed down. Clicking a vehicle opens Live tracking focused on it; there are no other tools here.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Popup } from "maplibre-gl";
import { Maximize2, Radio } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentDeviceLocation } from "@/lib/locations";
import { asVehicleType } from "@/lib/schemas/vehicle";
import { FleetLayer, STATE_COLORS, type FleetPoint } from "../map/fleet-layer";
import { deviceLabel, FALLBACK_VIEW, mapState, type MapState } from "../map/fleet-model";
import { useFleetStream } from "../map/use-fleet-stream";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const LEGEND: [MapState, string][] = [
  ["moving", "Moving"],
  ["idle", "Idling"],
  ["stopped", "Stopped"],
  ["offline", "Offline"]
];

function toPoint(d: CurrentDeviceLocation, now: number, offlineSeconds: number): FleetPoint | null {
  if (!d.location) return null;
  return {
    id: d.deviceId,
    name: deviceLabel(d),
    state: mapState(d, now, offlineSeconds),
    type: d.vehicle ? asVehicleType(d.vehicle.type) : "other",
    lngLat: [d.location.longitude, d.location.latitude],
    heading: d.location.headingDeg
  };
}

export function FleetGlance({ offlineSeconds }: { offlineSeconds: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) return setVisible(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Card className="mb-5 min-w-0 overflow-hidden">
      <CardHeader className="items-center">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Radio className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle>Fleet at a glance</CardTitle>
            <p className="m-0 text-xs text-muted-foreground">Live positions. Select a vehicle to open it on the full map.</p>
          </div>
        </div>
        <Link href="/map" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary no-underline hover:underline">
          <Maximize2 className="size-3.5" aria-hidden="true" /> Open live map
        </Link>
      </CardHeader>
      <div ref={box} className="relative h-[300px] bg-[#eef2f7] sm:h-[340px]">
        {visible ? <GlanceMap offlineSeconds={offlineSeconds} /> : <MapPlaceholder />}
        <ul aria-label="Map legend" className="pointer-events-none absolute bottom-2 left-2 m-0 flex list-none flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/90 px-2.5 py-1.5 p-0 text-[11px] font-medium text-foreground shadow-card backdrop-blur">
          {LEGEND.map(([s, label]) => (
            <li key={s} className="flex items-center gap-1.5 px-0.5">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: STATE_COLORS[s] }} />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function MapPlaceholder() {
  return <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#eef2f7_30%,#e3e9f2_50%,#eef2f7_70%)]" />;
}

function GlanceMap({ offlineSeconds }: { offlineSeconds: number }) {
  const div = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const layer = useRef<FleetLayer | null>(null);
  const fitted = useRef(false);
  const [failed, setFailed] = useState(false);

  const fit = (list: FleetPoint[]) => {
    const m = mapRef.current;
    if (!m || fitted.current || list.length === 0) return;
    fitted.current = true;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const p of list) {
      w = Math.min(w, p.lngLat[0]);
      e = Math.max(e, p.lngLat[0]);
      s = Math.min(s, p.lngLat[1]);
      n = Math.max(n, p.lngLat[1]);
    }
    m.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 12, duration: 0 });
  };

  const { devices } = useFleetStream({
    onSnapshot: (list) => {
      const pts = list.map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null);
      layer.current?.reset(pts);
      fit(pts);
    },
    onUpdate: (list) => {
      layer.current?.upsert(list.map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null));
    }
  });

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    // The map library is loaded only now, when the card is on screen.
    import("maplibre-gl")
      .then(({ default: maplibregl }) => {
        if (cancelled || !div.current) return;
        const m = new maplibregl.Map({
          container: div.current,
          style: STYLE_URL,
          center: FALLBACK_VIEW.center,
          zoom: FALLBACK_VIEW.zoom,
          attributionControl: { compact: true },
          cooperativeGestures: true
        });
        mapRef.current = m;
        m.getCanvas().setAttribute("aria-label", "Small map of the fleet. Open the live map for the full vehicle list.");
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        m.on("styleimagemissing", (e) => {
          if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
        });
        m.on("error", () => {
          if (!m.isStyleLoaded()) setFailed(true);
        });
        let popup: Popup | null = null;
        const fl = new FleetLayer(m, {
          onSelect: (id) => window.location.assign(`/map?focus=${encodeURIComponent(id)}`),
          onHover: (id, ll) => {
            popup?.remove();
            popup = null;
            const d = id ? devices.current.get(id) : undefined;
            if (!d || !ll) return;
            const el = document.createElement("div");
            el.className = "text-xs font-medium";
            el.textContent = deviceLabel(d);
            popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16 }).setLngLat(ll).setDOMContent(el).addTo(m);
          }
        });
        layer.current = fl;
        m.on("load", () => {
          fl.install();
          fl.setLabels(false);
          const pts = [...devices.current.values()].map((d) => toPoint(d, Date.now(), offlineSeconds)).filter((p): p is FleetPoint => p !== null);
          fl.reset(pts);
          fit(pts);
        });
        cleanup = () => {
          popup?.remove();
          fl.destroy();
          m.remove();
          mapRef.current = null;
          layer.current = null;
        };
      })
      .catch((err) => {
        console.error("map failed to load", err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* MapLibre sets position: relative on its container, so size it explicitly rather than with inset. */}
      <div ref={div} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
          <p className="m-0">
            The map could not load right now. <Link href="/vehicles">See vehicles as a list</Link>.
          </p>
        </div>
      )}
    </>
  );
}
