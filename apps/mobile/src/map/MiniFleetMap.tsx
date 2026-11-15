import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { FleetDevice } from "@/fleet/model";
import { isDark } from "@/theme";
import { DEFAULT_CENTER, DEFAULT_ZOOM, boundsOf, styleUrl, toFeatures } from "./model";
import { PIN_IMAGES } from "./sprites";

/**
 * A small, still map of the real fleet for the Overview card: the same 3D pins as the Live Map,
 * framed on every vehicle. It doesn't move under a finger; tapping the card opens the Live Map.
 */
export const MiniFleetMap = memo(function MiniFleetMap({ devices }: { devices: FleetDevice[] }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const data = useMemo(() => toFeatures(devices), [devices]);
  const bounds = useMemo(() => boundsOf(devices), [devices]);

  useEffect(() => {
    if (ready && bounds) camera.current?.fitBounds(bounds, { padding: { top: 40, right: 40, bottom: 56, left: 40 }, duration: 0 });
  }, [ready, bounds]);

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={styleUrl(isDark ? "dark" : "streets")}
      logo={false}
      attribution={false}
      compass={false}
      dragPan={false}
      touchZoom={false}
      doubleTapZoom={false}
      doubleTapHoldZoom={false}
      touchRotate={false}
      touchPitch={false}
      onDidFinishLoadingMap={() => setReady(true)}
      pointerEvents="none"
    >
      <Camera ref={camera} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />
      <Images images={PIN_IMAGES} />
      <GeoJSONSource id="mini-vehicles" data={data}>
        <Layer
          id="mini-pins"
          type="symbol"
          layout={{ "icon-image": ["get", "pin"], "icon-size": 0.32, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["case", ["==", ["get", "state"], "moving"], 2, 1] }}
        />
      </GeoJSONSource>
    </Map>
  );
});
