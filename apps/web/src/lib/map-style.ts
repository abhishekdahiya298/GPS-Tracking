/**
 * One place for the app's base maps. Every map (live map, dashboard, zones, loads,
 * share links) uses the same look, and follows the style the user last picked
 * on the live map. All styles come from the tile origin the CSP allows (lib/csp.ts).
 */
import type { Map as MlMap } from "maplibre-gl";

export const MAP_STYLES = [
  /** Colourful, Mapbox-Streets-like: green parks, blue water, yellow and orange main roads. */
  { id: "streets", label: "Streets", url: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "light", label: "Light", url: "https://tiles.openfreemap.org/styles/positron" },
  { id: "dark", label: "Dark", url: "https://tiles.openfreemap.org/styles/dark" }
] as const;

export type MapStyleId = (typeof MAP_STYLES)[number]["id"];
const STYLE_KEY = "rio.map.style";

export function styleUrl(id: MapStyleId): string {
  return MAP_STYLES.find((s) => s.id === id)!.url;
}

/** The user's base map, remembered per browser. Streets when nothing is saved or storage is blocked. */
export function savedStyle(): MapStyleId {
  try {
    const v = window.localStorage.getItem(STYLE_KEY);
    if (MAP_STYLES.some((s) => s.id === v)) return v as MapStyleId;
  } catch {
    /* storage blocked: use the default */
  }
  return "streets";
}

export function saveStyle(id: MapStyleId) {
  try {
    window.localStorage.setItem(STYLE_KEY, id);
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

/** Style URL for a new map: the user's saved choice. Call in the browser (inside an effect). */
export function preferredStyleUrl(): string {
  return styleUrl(typeof window === "undefined" ? "streets" : savedStyle());
}

/**
 * Shared setup for every map: OpenFreeMap styles reference a few sprite icons they don't ship,
 * which would otherwise log a warning per tile.
 */
export function patchMissingImages(m: MlMap) {
  m.on("styleimagemissing", (e) => {
    if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

const BUILDINGS_3D = "rio-buildings-3d";

/**
 * 3D buildings from the OpenMapTiles "building" layer, extruded to their real height.
 * Safe to call again after a style change (the layer is re-added if missing).
 */
export function setBuildings3d(m: MlMap, on: boolean, dark: boolean) {
  if (!m.getSource("openmaptiles")) return;
  if (!m.getLayer(BUILDINGS_3D)) {
    // Below the first label layer, so street names stay readable over the buildings.
    const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    m.addLayer(
      {
        id: BUILDINGS_3D,
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": dark ? "#2a3245" : "#e3ddd2",
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, ["coalesce", ["get", "render_height"], 6]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85
        }
      },
      firstSymbol
    );
  }
  m.setLayoutProperty(BUILDINGS_3D, "visibility", on ? "visible" : "none");
  // The Liberty style ships its own extruded buildings: hide them so they don't double up.
  if (m.getLayer("building-3d")) m.setLayoutProperty("building-3d", "visibility", "none");
}
