import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { colors, isDark, themed } from "@/theme";
import { bearing, styleUrl } from "@/map/model";
import { iconImages } from "@/map/sprites";
import { trackBounds, trackStops, type Track } from "./model";

/** Top-down vehicle pictures only: the replay vehicle turns with the road. */
const TOP_IMAGES = iconImages("top-");

/**
 * The route of one trip: the part already driven in blue, the rest in grey, A and B at the ends,
 * and the vehicle (seen from above, turned to its direction of travel) at the playhead.
 * Native code: never loaded in Expo Go.
 */
export default function TripMap({ track, at, index = 0, kind = "truck" }: { track: Track; at: [number, number]; index?: number; kind?: "truck" | "trailer" }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const bounds = useMemo(() => trackBounds(track), [track]);

  const route = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(() => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: track.at } }), [track]);
  const ends = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...trackStops(track).map((s) => ({ type: "Feature" as const, properties: { color: "#8f3d06", label: "P", stop: 1 }, geometry: { type: "Point" as const, coordinates: s.at } })),
        { type: "Feature", properties: { color: "#0f5c2c", label: "A" }, geometry: { type: "Point", coordinates: track.at[0]! } },
        { type: "Feature", properties: { color: "#9c1818", label: "B" }, geometry: { type: "Point", coordinates: track.at[track.at.length - 1]! } }
      ]
    }),
    [track]
  );
  // Direction of travel: towards the next point that is a few metres away (GPS jitter at stops would spin it).
  const heading = useMemo(() => {
    for (let i = index + 1; i < track.at.length; i++) {
      const b = track.at[i]!;
      if (Math.abs(b[0] - at[0]) + Math.abs(b[1] - at[1]) > 0.00008) return bearing(at, b);
    }
    for (let i = index; i > 0; i--) {
      const a = track.at[i - 1]!;
      if (Math.abs(a[0] - at[0]) + Math.abs(a[1] - at[1]) > 0.00008) return bearing(a, at);
    }
    return 0;
  }, [track, index, at]);
  const driven = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(() => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...track.at.slice(0, index + 1), at] } }), [track, index, at]);
  const marker = useMemo<GeoJSON.Feature<GeoJSON.Point>>(() => ({ type: "Feature", properties: { rot: heading }, geometry: { type: "Point", coordinates: at } }), [at, heading]);

  useEffect(() => {
    if (ready) camera.current?.fitBounds(bounds, { padding: { top: 50, right: 50, bottom: 50, left: 50 }, duration: 0 });
  }, [ready, bounds]);

  return (
    <Map style={styles.map} mapStyle={styleUrl(isDark ? "dark" : "streets")} logo={false} touchPitch={false} onDidFinishLoadingMap={() => setReady(true)}>
      <Camera ref={camera} initialViewState={{ bounds, padding: { top: 50, right: 50, bottom: 50, left: 50 } }} maxZoom={18} />
      <Images images={TOP_IMAGES} />
      <GeoJSONSource id="trip-route" data={route}>
        <Layer id="trip-route-casing" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": "#ffffff", "line-width": 8 }} />
        <Layer id="trip-route-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": isDark ? "#64748b" : "#94a3b8", "line-width": 5 }} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-driven" data={driven}>
        <Layer id="trip-driven-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": colors.primary, "line-width": 5 }} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-ends" data={ends}>
        <Layer id="trip-ends-dots" type="circle" paint={{ "circle-radius": ["case", ["has", "stop"], 10, 12], "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 }} />
        <Layer id="trip-ends-labels" type="symbol" layout={{ "text-field": ["get", "label"], "text-size": ["case", ["has", "stop"], 11, 13], "text-font": ["Noto Sans Bold"], "text-allow-overlap": true, "text-ignore-placement": true }} paint={{ "text-color": "#ffffff" }} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-marker" data={marker}>
        <Layer id="trip-marker-halo" type="circle" paint={{ "circle-radius": 22, "circle-color": colors.primary, "circle-opacity": 0.18 }} />
        <Layer
          id="trip-marker-vehicle"
          type="symbol"
          layout={{ "icon-image": `top-${kind}-moving`, "icon-size": 0.3, "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true }}
        />
      </GeoJSONSource>
    </Map>
  );
}

const styles = themed(() => ({ map: { flex: 1 } }));
