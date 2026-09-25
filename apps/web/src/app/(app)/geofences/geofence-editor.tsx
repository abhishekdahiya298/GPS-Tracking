"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { shapeRing, type LonLat } from "@rio-gps/core/geo";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { Circle, Hexagon, MoreHorizontal, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import type { GeofenceDto } from "@/lib/alerts";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK = { center: [-98.6, 39.8] as [number, number], zoom: 3.2 };
const COLORS = ["#2f5bea", "#15803d", "#b45309", "#c42b2b", "#7c3aed", "#0891b2"];
type Mode = { kind: "idle" } | { kind: "polygon"; points: LonLat[] } | { kind: "circle"; center: LonLat | null };

function fc(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Zone colour" className="flex gap-2">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={cn("size-7 cursor-pointer rounded-full border-2 border-white shadow-card outline-offset-2", value === c && "outline outline-2 outline-foreground")}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function GeofenceEditor({ initial, canWrite }: { initial: GeofenceDto[]; canWrite: boolean }) {
  const u = useUnits();
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [fences, setFences] = useState(initial);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [radius, setRadius] = useState(300);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<GeofenceDto | null>(null);
  const [deleting, setDeleting] = useState<GeofenceDto | null>(null);
  const fittedOnce = useRef(false);

  // Radius label in the organization's units (stored in metres).
  const fmtRadius = (m: number) => (u.system === "imperial" ? (m < 1609 ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${(m / 1609.344).toFixed(1)} mi`) : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = new maplibregl.Map({ container: mapDiv.current, style: STYLE_URL, center: FALLBACK.center, zoom: FALLBACK.zoom, attributionControl: { compact: true } });
    m.getCanvas().setAttribute("aria-label", "Zones map. Use the zone list for keyboard access.");
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("load", () => {
      m.addSource("fences", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "fences-fill", type: "fill", source: "fences", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "sel"], 0.28, 0.14] } });
      m.addLayer({ id: "fences-line", type: "line", source: "fences", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "sel"], 3.5, 2] } });
      if (m.getStyle().glyphs) {
        m.addLayer({ id: "fences-label", type: "symbol", source: "fences", layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"] }, paint: { "text-halo-color": "#fff", "text-halo-width": 1.5 } });
      }
      m.addSource("draft", { type: "geojson", data: fc([]) });
      m.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#e67e22", "fill-opacity": 0.2 } });
      m.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#e67e22", "line-width": 2, "line-dasharray": [2, 1] } });
      m.on("click", "fences-fill", (e) => {
        if (modeRef.current.kind !== "idle") return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setSelected(id);
      });
      setLoaded(true);
    });
    m.on("click", (e) => {
      const md = modeRef.current;
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      if (md.kind === "polygon") setMode({ kind: "polygon", points: [...md.points, p] });
      if (md.kind === "circle") setMode({ kind: "circle", center: p });
    });
    map.current = m;
    // No zones yet: start on the fleet instead of a continent view.
    if (initial.length === 0) {
      fetch("/api/locations/current", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const pts = (b?.devices ?? []).filter((d: { location: unknown }) => d.location).map((d: { location: { longitude: number; latitude: number } }) => [d.location.longitude, d.location.latitude] as [number, number]);
          if (!pts.length) return;
          const bb = new maplibregl.LngLatBounds();
          pts.forEach((p: [number, number]) => bb.extend(p));
          m.fitBounds(bb, { padding: 80, maxZoom: 13, duration: 0 });
        })
        .catch(() => undefined);
    }
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw saved zones (+ selection highlight).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("fences") as GeoJSONSource).setData(
      fc(fences.map((f) => ({ type: "Feature", properties: { id: f.id, name: f.name, color: f.color, sel: f.id === selected }, geometry: { type: "Polygon", coordinates: [shapeRing(f.shape)] } })))
    );
    if (fences.length && !fittedOnce.current) {
      fittedOnce.current = true;
      const b = new maplibregl.LngLatBounds();
      fences.forEach((f) => shapeRing(f.shape).forEach((p) => b.extend(p)));
      m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }, [fences, loaded, selected]);

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

  const focusZone = useCallback((f: GeofenceDto) => {
    setSelected(f.id);
    const b = new maplibregl.LngLatBounds();
    shapeRing(f.shape).forEach((p) => b.extend(p));
    map.current?.fitBounds(b, { padding: 80, maxZoom: 16, duration: 600 });
  }, []);

  const save = useCallback(async () => {
    setError(null);
    const md = modeRef.current;
    const body =
      md.kind === "polygon" ? { kind: "polygon", name, color, ring: md.points } : md.kind === "circle" && md.center ? { kind: "circle", name, color, center: md.center, radiusM: Math.round(radius) } : null;
    if (!body) return;
    setBusy(true);
    try {
      const out = await api<{ geofence: GeofenceDto }>("/api/geofences", { method: "POST", json: body });
      setFences((f) => [...f, out.geofence].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected(out.geofence.id);
      setMode({ kind: "idle" });
      setName("");
      toast.success(`Zone "${out.geofence.name}" saved. Use it in an alert rule to get notified.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [name, color, radius]);

  const canSave = name.trim().length > 0 && ((mode.kind === "polygon" && mode.points.length >= 3) || (mode.kind === "circle" && mode.center !== null));
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => fences.filter((f) => !q || f.name.toLowerCase().includes(q)), [fences, q]);

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row">
      <aside aria-label="Zones list" className="order-2 flex min-h-0 flex-1 flex-col border-t border-border bg-background md:order-1 md:w-[340px] md:flex-none md:border-r md:border-t-0">
        <div className="border-b border-border px-4 py-3">
          <h1 className="m-0 text-base font-semibold">Zones</h1>
          <p className="m-0 text-xs text-muted-foreground">Areas like depots or customer sites. Use them in alert rules for enter/leave alerts.</p>
        </div>

        {error && (
          <div className="px-4 pt-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {mode.kind === "idle" ? (
          <>
            <div className="grid gap-2 border-b border-border px-4 py-3">
              {canWrite && (
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" onClick={() => setMode({ kind: "polygon", points: [] })}>
                    <Hexagon /> Draw area
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setMode({ kind: "circle", center: null })}>
                    <Circle /> Circle
                  </Button>
                </div>
              )}
              {fences.length > 0 && <SearchInput value={search} onChange={setSearch} placeholder="Search zones…" label="Search zones" debounceMs={100} />}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {fences.length === 0 ? (
                <EmptyState icon={Hexagon} title="No zones yet" description={canWrite ? "Draw an area or place a circle on the map, then create an alert rule for it." : "An administrator can create zones."} />
              ) : shown.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No zones match “{search}”.</p>
              ) : (
                <ul className="m-0 list-none p-0" aria-label="Zones">
                  {shown.map((f) => (
                    <li key={f.id} className={cn("flex items-center gap-2 border-b border-border/70 pr-2", selected === f.id && "bg-primary-soft")}>
                      <button type="button" onClick={() => focusZone(f)} aria-pressed={selected === f.id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left">
                        <span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{ background: f.color }} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{f.name}</span>
                          <span className="block text-xs text-muted-foreground">{f.shape.kind === "circle" ? `Circle · ${fmtRadius(f.shape.radiusM)} radius` : `Area · ${f.shape.ring.length} corners`}</span>
                        </span>
                      </button>
                      {canWrite && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => setEditing(f)}>
                              <Pencil /> Rename / colour
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setDeleting(f)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-3 overflow-auto p-4">
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
              <strong>{mode.kind === "polygon" ? "New area" : "New circle"}</strong>
              <p className="m-0 mt-1 text-[13px]">
                {mode.kind === "polygon" ? `Click the map to add corners (${mode.points.length} so far, at least 3).` : mode.center ? "Adjust the radius, or click the map again to move it." : "Click the map to place the centre."}
              </p>
            </div>
            <Field id="z-name" label="Zone name" required>
              <Input id="z-name" placeholder="e.g. Main depot" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Colour</span>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            {mode.kind === "circle" && (
              <label className="grid gap-1.5 text-sm font-medium">
                Radius: {fmtRadius(radius)}
                <input type="range" min={20} max={5000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="accent-[var(--color-primary)]" aria-valuetext={fmtRadius(radius)} />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canSave} loading={busy} onClick={save}>
                <Plus /> Save zone
              </Button>
              {mode.kind === "polygon" && mode.points.length > 0 && (
                <Button variant="secondary" onClick={() => setMode({ kind: "polygon", points: mode.points.slice(0, -1) })}>
                  <Undo2 /> Undo
                </Button>
              )}
              <Button variant="ghost" onClick={() => setMode({ kind: "idle" })}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </aside>

      <div className="relative order-1 h-[55%] shrink-0 md:order-2 md:h-auto md:flex-1">
        {/* maplibre's CSS sets position:relative on the map element; size it via the wrapper. */}
        <div className="absolute inset-0">
          <div ref={mapDiv} className="h-full w-full" />
        </div>
      </div>

      <EditZoneDialog
        zone={editing}
        onClose={() => setEditing(null)}
        onSaved={(z) => {
          setFences((all) => all.map((x) => (x.id === z.id ? z : x)).sort((a, b) => a.name.localeCompare(b.name)));
          toast.success("Zone updated.");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete zone "${deleting?.name ?? ""}"?`}
        description="Alert rules that use this zone are deleted too. Past alerts stay in the history."
        confirmLabel="Delete zone"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/api/geofences/${deleting.id}`, { method: "DELETE" });
          setFences((all) => all.filter((x) => x.id !== deleting.id));
          if (selected === deleting.id) setSelected(null);
          setDeleting(null);
          toast.success("Zone deleted.");
        }}
      />
    </div>
  );
}

function EditZoneDialog({ zone, onClose, onSaved }: { zone: GeofenceDto | null; onClose: () => void; onSaved: (z: GeofenceDto) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (zone) {
      setName(zone.name);
      setColor(zone.color);
      setError(null);
    }
  }, [zone]);
  return (
    <Dialog open={zone !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {zone && (
        <DialogContent title="Edit zone" description="To change the shape, delete the zone and draw it again.">
          <form
            method="post"
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api(`/api/geofences/${zone.id}`, { method: "PATCH", json: { name, color } });
                onSaved({ ...zone, name: name.trim(), color });
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field id="ze-name" label="Name" required>
              <Input id="ze-name" value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Colour</span>
              <ColorPicker value={COLORS.includes(color) ? color : COLORS[0]!} onChange={setColor} />
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
