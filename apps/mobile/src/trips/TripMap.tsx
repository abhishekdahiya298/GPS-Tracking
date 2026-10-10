import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { colors } from "@/theme";
import { MAP_STYLE_URL } from "@/map/model";
import { trackBounds, type Track } from "./model";

/** The route of one trip with a marker at the playhead. Native code: never loaded in Expo Go. */
export default function TripMap({ track, at }: { track: Track; at: [number, number] }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const bounds = useMemo(() => trackBounds(track), [track]);

  const route = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(() => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: track.at } }), [track]);
  const ends = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { color: "#15803d" }, geometry: { type: "Point", coordinates: track.at[0]! } },
        { type: "Feature", properties: { color: "#c42b2b" }, geometry: { type: "Point", coordinates: track.at[track.at.length - 1]! } }
      ]
    }),
    [track]
  );
  const marker = useMemo<GeoJSON.Feature<GeoJSON.Point>>(() => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } }), [at]);

  useEffect(() => {
    if (ready) camera.current?.fitBounds(bounds, { padding: { top: 50, right: 50, bottom: 50, left: 50 }, duration: 0 });
  }, [ready, bounds]);

  return (
    <Map style={styles.map} mapStyle={MAP_STYLE_URL} logo={false} touchPitch={false} onDidFinishLoadingMap={() => setReady(true)}>
      <Camera ref={camera} initialViewState={{ bounds, padding: { top: 50, right: 50, bottom: 50, left: 50 } }} maxZoom={18} />
      <GeoJSONSource id="trip-route" data={route}>
        <Layer id="trip-route-casing" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": "#ffffff", "line-width": 7 }} />
        <Layer id="trip-route-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": colors.primary, "line-width": 4 }} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-ends" data={ends}>
        <Layer id="trip-ends-dots" type="circle" paint={{ "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 }} />
      </GeoJSONSource>
      <GeoJSONSource id="trip-marker" data={marker}>
        <Layer id="trip-marker-halo" type="circle" paint={{ "circle-radius": 16, "circle-color": colors.primary, "circle-opacity": 0.2 }} />
        <Layer id="trip-marker-dot" type="circle" paint={{ "circle-radius": 8, "circle-color": colors.primary, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 }} />
      </GeoJSONSource>
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
