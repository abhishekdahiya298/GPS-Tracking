import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import type { FleetDevice } from "@/fleet/model";
import { colors, isDark } from "@/theme";
import { useIconPrefs } from "./iconPrefs";
import { DEFAULT_CENTER, DEFAULT_ZOOM, boundsOf, iconPrefix, styleUrl, toFeatures } from "./model";
import { useMapEngine } from "./mapEngine";
import { MAP_ICONS, iconImages } from "./sprites";


/**
 * A small, still map of the real fleet for the Overview card: the same 3D pins as the Live Map,
 * framed on every vehicle. It doesn't move under a finger; tapping the card opens the Live Map.
 */
export const MiniFleetMap = memo(function MiniFleetMap({ devices, focus }: { devices: FleetDevice[]; focus?: [number, number] | null }) {
  const engine = useMapEngine();
  // Until the map has drawn, a plain panel in the card's colour covers it (never a white flash
  // or a half-drawn map); it fades the moment the map is placed on the fleet.
  const [drawn, setDrawn] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    // If the map never says it has drawn (offline), stop covering it after a few seconds.
    const t = setTimeout(() => setDrawn(true), 6000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (drawn) Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [drawn, fade]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {engine === "native" ? <NativeMini devices={devices} focus={focus} onDrawn={() => setDrawn(true)} /> : <OsmMini devices={devices} focus={focus} onDrawn={() => setDrawn(true)} />}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.muted, opacity: fade }]} />
    </View>
  );
});

/** The phone's own map (Apple Maps on iPhone): loads at once from the system's map cache. */
function NativeMini({ devices, focus, onDrawn }: { devices: FleetDevice[]; focus?: [number, number] | null; onDrawn: () => void }) {
  const map = useRef<MapView>(null);
  const prefs = useIconPrefs();
  const data = useMemo(() => toFeatures(devices, undefined, undefined, undefined, prefs), [devices, prefs]);
  const bounds = useMemo(() => boundsOf(devices), [devices]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    // Apple Maps draws from its own cache at once, so the map shows as soon as it is placed.
    if (focus || bounds) setTimeout(onDrawn, 120);
    if (focus) map.current?.animateToRegion({ latitude: focus[1], longitude: focus[0], latitudeDelta: 0.03, longitudeDelta: 0.03 }, 0);
    else if (bounds)
      map.current?.fitToCoordinates(
        [
          { latitude: bounds[1], longitude: bounds[0] },
          { latitude: bounds[3], longitude: bounds[2] }
        ],
        { edgePadding: { top: 50, right: 40, bottom: 56, left: 40 }, animated: false }
      );
  }, [ready, bounds, focus, onDrawn]);
  const top = prefs.style === "top";
  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: DEFAULT_CENTER[1], longitude: DEFAULT_CENTER[0], latitudeDelta: 20, longitudeDelta: 20 }}
      userInterfaceStyle={isDark ? "dark" : "light"}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsPointsOfInterests={false}
      onMapReady={() => setReady(true)}
    >
      {(data.features as GeoJSON.Feature<GeoJSON.Point, { deviceId: string; pin: string; rot?: number }>[]).map((f) => (
        <Marker key={f.properties.deviceId} coordinate={{ latitude: f.geometry.coordinates[1]!, longitude: f.geometry.coordinates[0]! }} anchor={{ x: 0.5, y: top ? 0.5 : 1 }} centerOffset={{ x: 0, y: top ? 0 : -17 }} tracksViewChanges={false}>
          {MAP_ICONS[f.properties.pin] ? <Image source={MAP_ICONS[f.properties.pin]!} style={[top ? { width: 22, height: 35 } : { width: 28, height: 35 }, top ? { transform: [{ rotate: `${f.properties.rot ?? 0}deg` }] } : null]} resizeMode="contain" /> : null}
        </Marker>
      ))}
    </MapView>
  );
}

/** The OpenStreetMap view, the same 3D pins as the Live Map. */
function OsmMini({ devices, focus, onDrawn }: { devices: FleetDevice[]; focus?: [number, number] | null; onDrawn: () => void }) {
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const prefs = useIconPrefs();
  const images = useMemo(() => iconImages(iconPrefix(prefs)), [prefs]);
  const data = useMemo(() => toFeatures(devices, undefined, undefined, undefined, prefs), [devices, prefs]);
  const bounds = useMemo(() => boundsOf(devices), [devices]);

  useEffect(() => {
    if (!ready) return;
    // One vehicle: centre on it close enough to read the road. A fleet: frame them all.
    if (focus) camera.current?.jumpTo({ center: focus, zoom: 13 });
    else if (bounds) camera.current?.fitBounds(bounds, { padding: { top: 40, right: 40, bottom: 56, left: 40 }, duration: 0 });
  }, [ready, bounds, focus]);

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
      onDidFinishRenderingMapFully={onDrawn}
    >
      <Camera ref={camera} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />
      <Images images={images} />
      <GeoJSONSource id="mini-vehicles" data={data}>
        <Layer
          id="mini-pins"
          type="symbol"
          layout={{ "icon-image": ["get", "pin"], "icon-size": 0.29, "icon-anchor": prefs.style === "pin" || prefs.style === "photo" ? "bottom" : "center", "icon-rotate": prefs.style === "top" ? ["get", "rot"] : 0, "icon-rotation-alignment": prefs.style === "top" ? "map" : "viewport", "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["case", ["==", ["get", "state"], "moving"], 2, 1] }}
        />
      </GeoJSONSource>
    </Map>
  );
}
