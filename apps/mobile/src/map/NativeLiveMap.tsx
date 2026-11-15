import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Image, Platform, StyleSheet, useWindowDimensions } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { colors, isDark } from "@/theme";
import type { IconPrefs } from "./model";
import { MAP_ICONS } from "./sprites";

/**
 * The phone's own map (Apple Maps on iPhone, Google Maps on Android when the build has a key),
 * used when the platform admin picks "Phone's own map". It draws the same vehicles, icons and
 * trails as the OpenStreetMap view and answers the same camera calls, so the rest of the screen
 * (sheet, search, neighbours) works unchanged.
 */
export interface CameraLike {
  flyTo(o: { center: [number, number]; zoom?: number; duration?: number; padding?: unknown }): void;
  easeTo(o: { center: [number, number]; zoom?: number; duration?: number; padding?: unknown }): void;
  fitBounds(b: [number, number, number, number], o?: { padding?: { top: number; right: number; bottom: number; left: number }; duration?: number }): void;
}

type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, { deviceId: string; pin: string; rot?: number; name?: string }>;

const zoomOf = (r: Region) => Math.log2(360 / Math.max(r.longitudeDelta, 1e-6));

export const NativeLiveMap = forwardRef<
  CameraLike,
  {
    vehicles: GeoJSON.FeatureCollection;
    trails: GeoJSON.FeatureCollection;
    selectedId: string | null;
    prefs: IconPrefs;
    bottomInset: number;
    topInset: number;
    initial: { center: [number, number]; zoom: number };
    /** iPhone only: start as the 3D Earth (Apple's satellite globe) until the fleet dive ends. */
    globe?: boolean;
    onSelect: (deviceId: string) => void;
    onMapPress: () => void;
    onReady: () => void;
    onZoom: (zoom: number) => void;
    onUserMove: () => void;
  }
>(function NativeLiveMap({ vehicles, trails, selectedId, prefs, bottomInset, topInset, initial, globe = false, onSelect, onMapPress, onReady, onZoom, onUserMove }, ref) {
  const map = useRef<MapView>(null);
  const { width, height } = useWindowDimensions();
  const isPin = prefs.style === "pin";
  const top = prefs.style === "top";
  // Started as the globe? Fixed at first render so the camera props never reset the view.
  const startedAsGlobe = useRef(globe && Platform.OS === "ios").current;

  const region = (center: [number, number], zoom: number): Region => {
    const lngDelta = (360 / 2 ** zoom) * (width / 256);
    return { latitude: center[1], longitude: center[0], longitudeDelta: lngDelta, latitudeDelta: lngDelta * (height / width) };
  };

  useImperativeHandle(ref, () => ({
    flyTo: ({ center, zoom, duration }) => map.current?.animateToRegion(region(center, zoom ?? 14), duration ?? 600),
    easeTo: ({ center, zoom, duration }) => {
      if (zoom === undefined) map.current?.animateCamera({ center: { latitude: center[1], longitude: center[0] } }, { duration: duration ?? 600 });
      else map.current?.animateToRegion(region(center, zoom), duration ?? 600);
    },
    fitBounds: ([w, s, e, n], o) =>
      map.current?.fitToCoordinates(
        [
          { latitude: s, longitude: w },
          { latitude: n, longitude: e }
        ],
        { edgePadding: o?.padding ?? { top: 80, right: 40, bottom: 80, left: 40 }, animated: (o?.duration ?? 0) > 0 }
      )
  }));

  const lines = useMemo(
    () =>
      trails.features
        .filter((f): f is GeoJSON.Feature<GeoJSON.LineString> => f.geometry.type === "LineString")
        .map((f, i) => ({ key: String((f.properties as { deviceId?: string } | null)?.deviceId ?? i), coords: f.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat!, longitude: lng! })) })),
    [trails]
  );

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      {...(startedAsGlobe
        ? { initialCamera: { center: { latitude: initial.center[1], longitude: initial.center[0] }, altitude: 22_000_000, pitch: 0, heading: 0, zoom: 1 } }
        : { initialRegion: region(initial.center, initial.zoom) })}
      mapType={globe && Platform.OS === "ios" ? "hybridFlyover" : "standard"}
      mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
      userInterfaceStyle={isDark ? "dark" : "light"}
      showsPointsOfInterests={false}
      showsBuildings
      pitchEnabled={false}
      toolbarEnabled={false}
      onMapReady={onReady}
      onPress={onMapPress}
      onPanDrag={onUserMove}
      onRegionChangeComplete={(r) => onZoom(zoomOf(r))}
    >
      {lines.map((l) => (
        <Polyline key={l.key} coordinates={l.coords} strokeColor="rgba(19,108,53,0.45)" strokeWidth={3} />
      ))}
      {(vehicles.features as VehicleFeature[])
        .filter((f) => f.geometry?.type === "Point" && f.properties?.deviceId)
        .map((f) => {
          const on = f.properties.deviceId === selectedId;
          const img = MAP_ICONS[f.properties.pin];
          const [lng, lat] = f.geometry.coordinates;
          return (
            <Marker
              key={f.properties.deviceId}
              identifier={f.properties.deviceId}
              coordinate={{ latitude: lat!, longitude: lng! }}
              anchor={isPin ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
              flat={top}
              rotation={top ? (f.properties.rot ?? 0) : 0}
              zIndex={on ? 10 : 1}
              tracksViewChanges={false}
              title={f.properties.name}
              onPress={(e) => {
                e.stopPropagation();
                onSelect(f.properties.deviceId);
              }}
            >
              {img ? <Image source={img} style={[top ? styles.top : isPin ? styles.pin : styles.round, on && styles.on]} resizeMode="contain" /> : null}
            </Marker>
          );
        })}
    </MapView>
  );
});

const styles = StyleSheet.create({
  pin: { width: 42, height: 52 },
  round: { width: 44, height: 48 },
  top: { width: 34, height: 54 },
  on: { transform: [{ scale: 1.15 }], shadowColor: colors.primary, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }
});
