import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { FleetDevice } from "@/fleet/model";
import { isDark } from "@/theme";
import { DEFAULT_CENTER, boundsOf, styleUrl, toFeatures } from "./model";
import { VEHICLE_IMAGES } from "./sprites";

const PADDING = { top: 36, right: 36, bottom: 44, left: 36 };

/**
 * The small live map on Home: every vehicle as a status dot, framed so all of them are in view.
 * It cannot be dragged; a tap on the card around it opens the full map. Native code: never
 * loaded in Expo Go.
 */
export default function MiniMap({ devices }: { devices: FleetDevice[] }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const data = useMemo(() => toFeatures(devices), [devices]);
  const bounds = useMemo(() => boundsOf(devices, 0.08), [devices]);
  // Frame the fleet again only when it has moved a fair way, not on every report.
  const frame = bounds ? bounds.map((n) => n.toFixed(1)).join(",") : "";

  useEffect(() => {
    if (ready && bounds) camera.current?.fitBounds(bounds, { padding: PADDING, duration: 500 });
    // `frame` stands for `bounds`, rounded.
  }, [ready, frame]);

  return (
    <View style={styles.fill} pointerEvents="none">
      <Map style={styles.fill} mapStyle={styleUrl(isDark ? "dark" : "streets")} logo={false} attribution={false} compass={false} dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false} onDidFinishLoadingMap={() => setReady(true)}>
        <Camera ref={camera} initialViewState={bounds ? { bounds, padding: PADDING } : { center: DEFAULT_CENTER, zoom: 3 }} maxZoom={13} />
        <Images images={VEHICLE_IMAGES} />
        <GeoJSONSource id="mini-vehicles" data={data}>
          <Layer id="mini-halo" type="circle" paint={{ "circle-radius": 11, "circle-color": ["get", "color"], "circle-opacity": 0.22 }} />
          <Layer id="mini-dots" type="circle" paint={{ "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }} />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
