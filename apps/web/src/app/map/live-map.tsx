"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shapeRing } from "@rio-gps/core";
import type { AlertEventDto, GeofenceDto } from "@/lib/alerts";
import type { CurrentDeviceLocation, LiveLocationEvent, LocationPoint } from "@/lib/locations";
import css from "./map.module.css";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const COLORS = { online: "#1f9d4c", offline: "#7a838f", never_seen: "#c98a00" } as const;
const MAX_HISTORY_POINTS = 20_000;
type Conn = "connecting" | "live" | "reconnecting";

function label(d: CurrentDeviceLocation) {
  return d.vehicle?.name ?? d.model ?? "Device";
}

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function haversineKm(a: LocationPoint, b: LocationPoint) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function markerEl(color: string, heading: number | null) {
  const el = document.createElement("div");
  el.className = css.marker ?? "";
  el.style.background = color;
  el.innerHTML = `<svg viewBox="0 0 24 24" style="transform:rotate(${heading ?? 0}deg)"><path d="M12 2l7 18-7-4-7 4z"/></svg>`;
  return el;
}

function localInput(d: Date) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function LiveMap({ orgName }: { orgName: string }) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const playbackMarker = useRef<Marker | null>(null);
  const fitted = useRef(false);
  const [devices, setDevices] = useState<Record<string, CurrentDeviceLocation>>({});
  const [conn, setConn] = useState<Conn>("connecting");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mapError, setMapError] = useState<string | null>(null);
  const [unack, setUnack] = useState<number | null>(null);
  const [toasts, setToasts] = useState<AlertEventDto[]>([]);

  // History state
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 24 * 3600_000)));
  // Empty "to" means "now" at query time, so newly recorded points are included.
  const [to, setTo] = useState("");
  const [track, setTrack] = useState<LocationPoint[]>([]);
  const [histBusy, setHistBusy] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/alerts?limit=1&unacknowledged=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setUnack(b.unacknowledged))
      .catch(() => undefined);
  }, []);

  // Map init
  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: [-118.24, 34.05], zoom: 9, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    // The OpenFreeMap style references a few icons its sprite doesn't ship; supply a
    // transparent placeholder instead of logging a warning per missing icon.
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("error", (e) => {
      // Tile/style load failures are surfaced, not swallowed.
      console.error("map error", e.error);
      if (!m.isStyleLoaded()) setMapError("Map tiles failed to load. Live data is still updating.");
    });
    m.on("load", () => {
      setMapError(null);
      m.addSource("track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "track-line", type: "line", source: "track", paint: { "line-color": "#3056d3", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-join": "round", "line-cap": "round" } });
      // Zones overlay (skipped silently if the role can't read zones).
      fetch("/api/geofences", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { geofences: GeofenceDto[] } | null) => {
          if (!b || !map.current) return;
          m.addSource("fences", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: b.geofences.map((f) => ({ type: "Feature", properties: { name: f.name, color: f.color }, geometry: { type: "Polygon", coordinates: [shapeRing(f.shape)] } }))
            }
          });
          m.addLayer({ id: "fences-fill", type: "fill", source: "fences", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 } }, "track-line");
          m.addLayer({ id: "fences-line", type: "line", source: "fences", paint: { "line-color": ["get", "color"], "line-width": 1.5 } }, "track-line");
        })
        .catch((err) => console.error("zones failed to load", err));
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Live stream with snapshot-on-connect; reconnect with backoff; send to login when the session ends.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      setConn(attempt === 0 ? "connecting" : "reconnecting");
      es = new EventSource("/api/locations/stream");
      es.addEventListener("snapshot", (ev) => {
        attempt = 0;
        setConn("live");
        const snap = JSON.parse((ev as MessageEvent).data) as { devices: CurrentDeviceLocation[] };
        setDevices((prev) => {
          const next: Record<string, CurrentDeviceLocation> = {};
          for (const d of snap.devices) {
            const old = prev[d.deviceId];
            // Keep a live update that raced ahead of the snapshot.
            next[d.deviceId] =
              old?.location && d.location && old.location.recordedAt > d.location.recordedAt ? { ...d, location: old.location } : d;
          }
          return next;
        });
      });
      es.addEventListener("location", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as LiveLocationEvent;
        setDevices((prev) => {
          const d = prev[e.deviceId];
          if (!d) return prev; // unknown to this org's snapshot: ignore
          if (d.location && d.location.recordedAt >= e.recordedAt) return prev;
          const loc = {
            latitude: e.latitude,
            longitude: e.longitude,
            speedKph: e.speedKph,
            headingDeg: e.headingDeg,
            altitudeM: e.altitudeM,
            ignition: e.ignition,
            motion: e.motion,
            recordedAt: e.recordedAt,
            receivedAt: e.receivedAt
          };
          return { ...prev, [e.deviceId]: { ...d, location: loc, connectivity: "online", lastSeenAt: e.receivedAt } };
        });
      });
      es.addEventListener("alert", (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as AlertEventDto;
        setUnack((n) => (n ?? 0) + 1);
        setToasts((t) => [a, ...t].slice(0, 3));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 12_000);
      });
      es.addEventListener("end", (ev) => {
        const { reason } = JSON.parse((ev as MessageEvent).data) as { reason: string };
        es?.close();
        if (reason === "session_ended") window.location.assign("/login?next=/map");
        else schedule();
      });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) schedule();
        else setConn("reconnecting");
      };
    };

    const schedule = async () => {
      if (stopped) return;
      es?.close();
      setConn("reconnecting");
      // A non-200 (e.g. 401) closes EventSource for good; check why before retrying.
      try {
        const r = await fetch("/api/locations/current", { cache: "no-store" });
        if (r.status === 401) {
          window.location.assign("/login?next=/map");
          return;
        }
      } catch {
        // network down: keep retrying
      }
      attempt++;
      retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, []);

  // Sync markers with device state
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    const bounds = new maplibregl.LngLatBounds();
    for (const d of Object.values(devices)) {
      if (!d.location) continue;
      seen.add(d.deviceId);
      const ll: [number, number] = [d.location.longitude, d.location.latitude];
      bounds.extend(ll);
      const existing = markers.current.get(d.deviceId);
      existing?.remove();
      const mk = new maplibregl.Marker({ element: markerEl(COLORS[d.connectivity], d.location.headingDeg) })
        .setLngLat(ll)
        .setPopup(
          new maplibregl.Popup({ offset: 16 }).setText(
            `${label(d)} · ${d.location.speedKph ?? 0} km/h · ${new Date(d.location.recordedAt).toLocaleString()}`
          )
        )
        .addTo(m);
      mk.getElement().addEventListener("click", () => setSelected(d.deviceId));
      markers.current.set(d.deviceId, mk);
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
    if (!fitted.current && !bounds.isEmpty()) {
      fitted.current = true;
      m.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 0 });
    }
  }, [devices]);

  const list = useMemo(() => Object.values(devices).sort((a, b) => label(a).localeCompare(label(b))), [devices]);

  // Deep link from trip reports: /map?device=<id>&from=<ISO>&to=<ISO>
  const deepLink = useRef<{ device: string; from: string; to: string } | null>(null);
  const [autoLoad, setAutoLoad] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const device = q.get("device");
    const f = q.get("from");
    const t = q.get("to");
    if (device && f && t && !Number.isNaN(Date.parse(f)) && !Number.isNaN(Date.parse(t))) deepLink.current = { device, from: f, to: t };
  }, []);
  useEffect(() => {
    const dl = deepLink.current;
    if (!dl || !devices[dl.device]) return;
    deepLink.current = null;
    setSelected(dl.device);
    setFrom(localInput(new Date(dl.from)));
    setTo(localInput(new Date(dl.to)));
    setAutoLoad(true);
  }, [devices]);

  const focus = useCallback((d: CurrentDeviceLocation) => {
    setSelected(d.deviceId);
    if (d.location) map.current?.flyTo({ center: [d.location.longitude, d.location.latitude], zoom: 15 });
  }, []);

  const drawTrack = useCallback((pts: LocationPoint[]) => {
    const m = map.current;
    const src = m?.getSource("track") as GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: pts.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.longitude, p.latitude]) } }] : []
    });
    if (m && pts.length > 0) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.longitude, p.latitude]));
      m.fitBounds(b, { padding: 60, maxZoom: 16 });
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!selected) return;
    setHistBusy(true);
    setHistError(null);
    try {
      const pts: LocationPoint[] = [];
      let next: string | null = null;
      do {
        const qs = new URLSearchParams({ deviceId: selected, from: new Date(from).toISOString(), limit: "5000" });
        if (to) qs.set("to", new Date(to).toISOString());
        if (next) qs.set("cursor", next);
        const r = await fetch(`/api/locations/history?${qs}`, { cache: "no-store" });
        if (r.status === 401) {
          window.location.assign("/login?next=/map");
          return;
        }
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
        pts.push(...body.points);
        next = body.nextCursor;
      } while (next && pts.length < MAX_HISTORY_POINTS);
      setTrack(pts);
      setCursor(pts.length ? pts.length - 1 : 0);
      drawTrack(pts);
      if (!pts.length) setHistError("No points in this time range.");
    } catch (err) {
      setHistError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistBusy(false);
    }
  }, [selected, from, to, drawTrack]);

  useEffect(() => {
    if (autoLoad && selected) {
      setAutoLoad(false);
      void loadHistory();
    }
  }, [autoLoad, selected, loadHistory]);

  const clearHistory = useCallback(() => {
    setTrack([]);
    drawTrack([]);
    playbackMarker.current?.remove();
    playbackMarker.current = null;
  }, [drawTrack]);

  // Playback marker
  useEffect(() => {
    const m = map.current;
    const p = track[cursor];
    if (!m || !p) return;
    if (!playbackMarker.current) {
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#3056d3;border:3px solid #fff;box-shadow:0 0 0 1px #3056d3";
      playbackMarker.current = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(m);
    } else playbackMarker.current.setLngLat([p.longitude, p.latitude]);
  }, [track, cursor]);

  const stats = useMemo(() => {
    if (track.length < 2) return null;
    let km = 0;
    let max = 0;
    for (let i = 1; i < track.length; i++) {
      km += haversineKm(track[i - 1]!, track[i]!);
      max = Math.max(max, track[i]!.speedKph ?? 0);
    }
    return { km: km.toFixed(1), max: Math.round(max) };
  }, [track]);

  const connColor = conn === "live" ? COLORS.online : conn === "connecting" ? COLORS.never_seen : "#c0392b";
  const point = track[cursor];

  return (
    <div className={css.shell}>
      <aside className={css.side}>
        <div className={css.head}>
          <h1>{orgName}</h1>
          <span className={css.conn} role="status">
            <span className={css.dot} style={{ background: connColor }} /> {conn}
          </span>
          {unack !== null && (
            <a href="/alerts" style={{ fontWeight: unack > 0 ? 700 : 400, color: unack > 0 ? "#c0392b" : undefined }}>
              Alerts{unack > 0 ? ` (${unack})` : ""}
            </a>
          )}
          <a href="/geofences">Zones</a>
          <a href="/reports">Reports</a>
          <a href="/vehicles">Vehicles</a>
          <a href="/dashboard">Dashboard</a>
        </div>
        <div className={css.list}>
          {list.length === 0 && <p className={css.meta} style={{ padding: 14 }}>No devices yet.</p>}
          {list.map((d) => (
            <div
              key={d.deviceId}
              className={`${css.item} ${selected === d.deviceId ? css.itemActive : ""}`}
              onClick={() => focus(d)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && focus(d)}
            >
              <strong>
                {label(d)}
                <span className={`${css.badge} ${css[d.connectivity]}`}>{d.connectivity.replace("_", " ")}</span>
              </strong>
              <div className={css.meta}>
                {d.location
                  ? `${d.location.speedKph ?? 0} km/h · ignition ${d.location.ignition === null ? "?" : d.location.ignition ? "on" : "off"} · fix ${ago(d.location.recordedAt, now)}`
                  : "No location yet"}
              </div>
              <div className={css.meta}>Last seen {ago(d.lastSeenAt, now)}</div>
            </div>
          ))}
        </div>
        <div className={css.history}>
          <strong>History</strong>
          {!selected ? (
            <span className={css.meta}>Select a device to view its track.</span>
          ) : (
            <>
              <div className={css.row}>
                <label>
                  From
                  <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label>
                  To
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} placeholder="now" title="Leave empty for now" />
                </label>
              </div>
              <div className={css.row}>
                <button type="button" onClick={loadHistory} disabled={histBusy}>
                  {histBusy ? "Loading…" : "Show track"}
                </button>
                <button type="button" onClick={clearHistory} disabled={!track.length}>
                  Clear
                </button>
              </div>
              {histError && <span className={css.error}>{histError}</span>}
              {track.length > 0 && (
                <>
                  <input type="range" min={0} max={track.length - 1} value={cursor} onChange={(e) => setCursor(Number(e.target.value))} aria-label="Playback position" />
                  {point && (
                    <span className={css.stats}>
                      {new Date(point.recordedAt).toLocaleString()} · {point.speedKph ?? 0} km/h
                    </span>
                  )}
                  <span className={css.stats}>
                    {track.length.toLocaleString()} points{stats ? ` · ${stats.km} km · max ${stats.max} km/h` : ""}
                    {track.length >= MAX_HISTORY_POINTS ? " · truncated, narrow the range" : ""}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </aside>
      <div className={css.map}>
        <div ref={mapDiv} className={css.mapInner} />
        {toasts.length > 0 && (
          <div role="status" aria-live="polite" style={{ position: "absolute", top: 10, left: 10, right: 60, display: "grid", gap: 6, zIndex: 2 }}>
            {toasts.map((t) => (
              <a key={t.id} href="/alerts" style={{ background: "#fff", borderLeft: "4px solid #c0392b", boxShadow: "0 2px 8px rgba(0,0,0,.2)", padding: "8px 12px", borderRadius: 6, fontSize: 13, color: "#1b1f24", textDecoration: "none" }}>
                <strong>{t.vehicleName ?? "Device"}</strong> · {t.ruleName}
                <div style={{ color: "#5b6470" }}>{new Date(t.occurredAt).toLocaleTimeString()}</div>
              </a>
            ))}
          </div>
        )}
        {mapError && (
          <div role="alert" style={{ position: "absolute", top: 10, left: 10, right: 60, background: "#fff4e0", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
            {mapError}
          </div>
        )}
      </div>
    </div>
  );
}
