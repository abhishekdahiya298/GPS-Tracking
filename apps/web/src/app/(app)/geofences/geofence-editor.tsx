"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { shapeRing, type LonLat } from "@rio-gps/core";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import type { GeofenceDto } from "@/lib/alerts";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
type Mode = { kind: "idle" } | { kind: "polygon"; points: LonLat[] } | { kind: "circle"; center: LonLat | null };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (res.status === 401) {
    window.location.assign("/login?next=/geofences");
    throw new Error("Signed out");
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body;
}

function fc(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export function GeofenceEditor({ initial, canWrite }: { initial: GeofenceDto[]; canWrite: boolean }) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [fences, setFences] = useState(initial);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(300);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: [-79.7, 43.7], zoom: 10 });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("load", () => {
      m.addSource("fences", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "fences-fill", type: "fill", source: "fences", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 } });
      m.addLayer({ id: "fences-line", type: "line", source: "fences", paint: { "line-color": ["get", "color"], "line-width": 2 } });
      m.addLayer({ id: "fences-label", type: "symbol", source: "fences", layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"] }, paint: { "text-halo-color": "#fff", "text-halo-width": 1.5 } });
      m.addSource("draft", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#e67e22", "fill-opacity": 0.2 } });
      m.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#e67e22", "line-width": 2, "line-dasharray": [2, 1] } });
      setLoaded(true);
    });
    m.on("click", (e) => {
      const md = modeRef.current;
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      if (md.kind === "polygon") setMode({ kind: "polygon", points: [...md.points, p] });
      if (md.kind === "circle") setMode({ kind: "circle", center: p });
    });
    map.current = m;
    // Center on the fleet if there is one.
    fetch("/api/locations/current", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const loc = b?.devices?.find((d: { location: unknown }) => d.location)?.location;
        if (loc && initial.length === 0) m.jumpTo({ center: [loc.longitude, loc.latitude], zoom: 13 });
      })
      .catch(() => undefined);
    return () => {
      m.remove();
      map.current = null;
    };
  }, [initial.length]);

  // Draw saved fences.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("fences") as GeoJSONSource).setData(
      fc(fences.map((f) => ({ type: "Feature", properties: { name: f.name, color: f.color }, geometry: { type: "Polygon", coordinates: [shapeRing(f.shape)] } })))
    );
    if (fences.length) {
      const b = new maplibregl.LngLatBounds();
      fences.forEach((f) => shapeRing(f.shape).forEach((p) => b.extend(p)));
      m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }, [fences, loaded]);

  // Draw the draft.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    let features: Feature[] = [];
    if (mode.kind === "polygon" && mode.points.length >= 2) {
      const pts = mode.points.length >= 3 ? [...mode.points, mode.points[0]!] : mode.points;
      features = [{ type: "Feature", properties: {}, geometry: mode.points.length >= 3 ? { type: "Polygon", coordinates: [pts] } : { type: "LineString", coordinates: pts } }];
    }
    if (mode.kind === "circle" && mode.center) {
      features = [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [shapeRing({ kind: "circle", center: mode.center, radiusM: radius })] } }];
    }
    (m.getSource("draft") as GeoJSONSource).setData(fc(features));
    m.getCanvas().style.cursor = mode.kind === "idle" ? "" : "crosshair";
  }, [mode, radius, loaded]);

  const save = useCallback(async () => {
    setError(null);
    const md = modeRef.current;
    const body =
      md.kind === "polygon"
        ? { kind: "polygon", name, ring: md.points }
        : md.kind === "circle" && md.center
          ? { kind: "circle", name, center: md.center, radiusM: Math.round(radius) }
          : null;
    if (!body) return;
    setBusy(true);
    try {
      const out = await api("/api/geofences", { method: "POST", body: JSON.stringify(body) });
      setFences((f) => [...f, out.geofence].sort((a, b) => a.name.localeCompare(b.name)));
      setMode({ kind: "idle" });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }, [name, radius]);

  const remove = async (f: GeofenceDto) => {
    if (!window.confirm(`Delete zone "${f.name}"? Alert rules that use it are deleted too.`)) return;
    setError(null);
    try {
      await api(`/api/geofences/${f.id}`, { method: "DELETE" });
      setFences((all) => all.filter((x) => x.id !== f.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  };

  const canSave = name.trim().length > 0 && ((mode.kind === "polygon" && mode.points.length >= 3) || (mode.kind === "circle" && mode.center !== null));
  const side = { padding: 14, display: "grid", gap: 10, alignContent: "start", overflow: "auto", minWidth: 0 } as const;
  const inp = { padding: 8, fontSize: 15, width: "100%", boxSizing: "border-box" } as const;

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)", fontFamily: "system-ui" }} className="rio-split">
      <style>{`@media (max-width: 760px){ .rio-split{ grid-template-columns: minmax(0,1fr) !important; grid-template-rows: 55% 45%; } .rio-split > aside{ order: 2 } }`}</style>
      <aside style={{ ...side, borderRight: "1px solid #e3e6ea" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Zones</h1>
        {error && (
          <p role="alert" style={{ color: "#b00020", margin: 0 }}>
            {error}
          </p>
        )}
        {canWrite && mode.kind === "idle" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setMode({ kind: "polygon", points: [] })}>
              + Polygon
            </button>
            <button type="button" onClick={() => setMode({ kind: "circle", center: null })}>
              + Circle
            </button>
          </div>
        )}
        {mode.kind !== "idle" && (
          <div style={{ display: "grid", gap: 8, border: "1px solid #f0c36d", background: "#fff8e1", padding: 10, borderRadius: 8 }}>
            <strong>{mode.kind === "polygon" ? "New polygon" : "New circle"}</strong>
            <span style={{ fontSize: 13, color: "#5b6470" }}>
              {mode.kind === "polygon" ? `Click the map to add corners (${mode.points.length} so far, need 3+).` : mode.center ? "Adjust the radius, or click again to move." : "Click the map to place the center."}
            </span>
            <input aria-label="Zone name" placeholder="Zone name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} style={inp} />
            {mode.kind === "circle" && (
              <label style={{ fontSize: 13 }}>
                Radius: {Math.round(radius)} m
                <input type="range" min={20} max={5000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }} aria-label="Radius in meters" />
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={!canSave || busy} onClick={save}>
                Save zone
              </button>
              {mode.kind === "polygon" && mode.points.length > 0 && (
                <button type="button" onClick={() => setMode({ kind: "polygon", points: mode.points.slice(0, -1) })}>
                  Undo
                </button>
              )}
              <button type="button" onClick={() => setMode({ kind: "idle" })}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div>
          {fences.length === 0 && <p style={{ color: "#5b6470" }}>No zones yet.</p>}
          {fences.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f0f2f4" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: f.color, flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.name}{" "}
                <small style={{ color: "#5b6470" }}>{f.shape.kind === "circle" ? `circle ${f.shape.radiusM} m` : `${f.shape.ring.length} corners`}</small>
              </span>
              {canWrite && (
                <button type="button" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>
      <div style={{ position: "relative", minHeight: 0 }}>
        <div ref={mapDiv} style={{ position: "absolute", inset: 0 }} />
      </div>
    </div>
  );
}
