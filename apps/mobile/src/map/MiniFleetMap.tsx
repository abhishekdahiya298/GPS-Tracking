import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { FleetDevice } from "@/fleet/model";
import { isDark } from "@/theme";
import { useIconPrefs } from "./iconPrefs";
import { DEFAULT_CENTER, DEFAULT_ZOOM, boundsOf, iconPrefix, styleUrl, toFeatures } from "./model";
import { iconImages } from "./sprites";

/**
 * A small, still map of the real fleet for the Overview card: the same 3D pins as the Live Map,
 * framed on every vehicle. It doesn't move under a finger; tapping the card opens the Live Map.
 */
export const MiniFleetMap = memo(function MiniFleetMap({ devices }: { devices: FleetDevice[] }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const prefs = useIconPrefs();
  const images = useMemo(() => iconImages(iconPrefix(prefs)), [prefs]);
  const data = useMemo(() => toFeatures(devices, undefined, undefined, undefined, prefs), [devices, prefs]);
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
      <Images images={images} />
      <GeoJSONSource id="mini-vehicles" data={data}>
        <Layer
          id="mini-pins"
          type="symbol"
          layout={{ "icon-image": ["get", "pin"], "icon-size": 0.29, "icon-anchor": prefs.style === "pin" ? "bottom" : "center", "icon-rotate": prefs.style === "top" ? ["get", "rot"] : 0, "icon-rotation-alignment": prefs.style === "top" ? "map" : "viewport", "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["case", ["==", ["get", "state"], "moving"], 2, 1] }}
        />
      </GeoJSONSource>
    </Map>
  );
});
