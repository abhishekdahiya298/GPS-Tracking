"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { circleRing, type LonLat } from "@rio-gps/core/geo";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
type Stop = { latitude: number; longitude: number; radiusM: number };
type Feature = GeoJSON.Feature;
const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

function pin(label: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center`;
  const t = document.createElement("span");
  t.textContent = label;
  t.style.cssText = "transform:rotate(45deg);color:#fff;font:600 12px system-ui,sans-serif";
  el.appendChild(t);
  return el;
}

function truckDot(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#1d4fb8;border:3px solid #fff;box-shadow:0 0 0 6px rgba(29,79,184,.25),0 1px 4px rgba(0,0,0,.4)";
  return el;
}

/**
 * Pickup (P) and delivery (D) with their arrival circles, the trail driven so far and the
 * current position. Fits everything in view once; later updates move the marker only.
 */
export function LoadMap({ pickup, delivery, trail = [], position, className, label = "Load map" }: { pickup: Stop; delivery: Stop; trail?: [number, number, number][]; position: { latitude: number; longitude: number } | null; className?: string; label?: string }) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const truck = useRef<Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!div.current || map.current) return;
    const m = new maplibregl.Map({ container: div.current, style: STYLE_URL, center: [pickup.longitude, pickup.latitude], zoom: 6, attributionControl: { compact: true } });
    m.getCanvas().setAttribute("aria-label", label);
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("load", () => {
      m.addSource("stops", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "stops-fill", type: "fill", source: "stops", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 } });
      m.addLayer({ id: "stops-line", type: "line", source: "stops", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 1] } });
      m.addSource("trail", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "trail-line", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1d4fb8", "line-width": 3.5, "line-opacity": 0.8 } });
      setLoaded(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stops: circles + pins.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const ring = (s: Stop) => circleRing([s.longitude, s.latitude], s.radiusM);
    (m.getSource("stops") as GeoJSONSource).setData(
      fc([
        { type: "Feature", properties: { color: "#0e7c66" }, geometry: { type: "Polygon", coordinates: [ring(pickup)] } },
        { type: "Feature", properties: { color: "#d81e2c" }, geometry: { type: "Polygon", coordinates: [ring(delivery)] } }
      ])
    );
    const markers = [
      new maplibregl.Marker({ element: pin("P", "#0e7c66"), anchor: "bottom" }).setLngLat([pickup.longitude, pickup.latitude]).addTo(m),
      new maplibregl.Marker({ element: pin("D", "#d81e2c"), anchor: "bottom" }).setLngLat([delivery.longitude, delivery.latitude]).addTo(m)
    ];
    return () => markers.forEach((mk) => mk.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when a stop actually changes
  }, [loaded, pickup.latitude, pickup.longitude, pickup.radiusM, delivery.latitude, delivery.longitude, delivery.radiusM]);

  // Trail.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const coords = trail.map(([lon, lat]) => [lon, lat]);
    (m.getSource("trail") as GeoJSONSource).setData(fc(coords.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : []));
  }, [loaded, trail]);

  // Current position.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    if (!position) {
      truck.current?.remove();
      truck.current = null;
      return;
    }
    const ll: LonLat = [position.longitude, position.latitude];
    if (!truck.current) truck.current = new maplibregl.Marker({ element: truckDot() }).setLngLat(ll).addTo(m);
    else truck.current.setLngLat(ll);
  }, [loaded, position?.latitude, position?.longitude, position]);

  // Fit once.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || fitted.current) return;
    fitted.current = true;
    const b = new maplibregl.LngLatBounds();
    b.extend([pickup.longitude, pickup.latitude]).extend([delivery.longitude, delivery.latitude]);
    if (position) b.extend([position.longitude, position.latitude]);
    m.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
  }, [loaded, pickup, delivery, position]);

  return <div ref={div} className={cn("h-full min-h-[280px] w-full overflow-hidden rounded-xl", className)} />;
}
