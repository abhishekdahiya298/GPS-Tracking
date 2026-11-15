import { Ionicons } from "@expo/vector-icons";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType } from "react-native";
import MapView, { AnimatedRegion, MarkerAnimated, Polyline, type Region } from "react-native-maps";
import { colors, elevation, isDark, themed } from "@/theme";
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

type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, { deviceId: string; pin: string; rot?: number; name?: string; color?: string }>;

/** Which map to draw: streets, satellite, or "auto" (streets up close, satellite when zoomed far out). */
export type NativeMapType = "auto" | "street" | "satellite";
/** Camera height for the opening: far enough that the whole Earth fits on a phone held upright. */
const GLOBE_ALTITUDE_M = 42_000_000;
/** How long a vehicle takes to glide from one reported position to the next. */
const GLIDE_MS = 1000;

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
    mapType?: NativeMapType;
    /** Text shown in a bubble over the chosen vehicle (its speed, or how long it has stood there). */
    bubble?: string | null;
    /** The part of the world on screen, as [west, south, east, north], after each move. */
    onBounds?: (bounds: [number, number, number, number]) => void;
    onSelect: (deviceId: string) => void;
    onMapPress: () => void;
    onReady: () => void;
    onZoom: (zoom: number) => void;
    onUserMove: () => void;
  }
>(function NativeLiveMap({ vehicles, trails, selectedId, prefs, bottomInset, topInset, initial, globe = false, mapType = "auto", bubble, onBounds, onSelect, onMapPress, onReady, onZoom, onUserMove }, ref) {
  const map = useRef<MapView>(null);
  const { width, height } = useWindowDimensions();
  const isPin = prefs.style === "pin";
  const top = prefs.style === "top";
  // Started as the globe? Fixed at first render so the camera props never reset the view.
  const startedAsGlobe = useRef(globe && Platform.OS === "ios").current;
  const shown = useRef<Region | null>(null);
  const diving = useRef(startedAsGlobe);
  const [far, setFar] = useState(false);

  const region = (center: [number, number], zoom: number): Region => {
    const lngDelta = (360 / 2 ** zoom) * (width / 256);
    return { latitude: center[1], longitude: center[0], longitudeDelta: lngDelta, latitudeDelta: lngDelta * (height / width) };
  };

  // A hop to somewhere far off the screen would fly over map that is not loaded yet (a blank
  // screen), so it is made in one quick step; a nearby move glides.
  const ms = (center: [number, number], duration: number | undefined): number => {
    const r = shown.current;
    if (!r) return duration ?? 600;
    const away = Math.max(Math.abs(center[0] - r.longitude) / Math.max(r.longitudeDelta, 1e-6), Math.abs(center[1] - r.latitude) / Math.max(r.latitudeDelta, 1e-6));
    return away > 2.5 ? 1 : (duration ?? 600);
  };

  useImperativeHandle(ref, () => ({
    flyTo: ({ center, zoom, duration }) => map.current?.animateToRegion(region(center, zoom ?? 14), ms(center, duration)),
    easeTo: ({ center, zoom, duration }) => {
      if (zoom === undefined) map.current?.animateCamera({ center: { latitude: center[1], longitude: center[0] } }, { duration: ms(center, duration) });
      else map.current?.animateToRegion(region(center, zoom), ms(center, duration));
    },
    fitBounds: ([w, s, e, n], o) => {
      const fit = () =>
        map.current?.fitToCoordinates(
          [
            { latitude: s, longitude: w },
            { latitude: n, longitude: e }
          ],
          { edgePadding: o?.padding ?? { top: 80, right: 40, bottom: 80, left: 40 }, animated: (o?.duration ?? 0) > 0 }
        );
      // The opening: from the whole Earth, one long smooth descent to the fleet (the camera's
      // height is animated, which a plain "fit" cannot do), then settle exactly on the vehicles.
      if (diving.current && (o?.duration ?? 0) >= 1500) {
        diving.current = false;
        const spanM = Math.max((n - s) * 111_320, (e - w) * 111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180), 2_000);
        map.current?.animateCamera({ center: { latitude: (s + n) / 2, longitude: (w + e) / 2 }, altitude: spanM * 2.4, pitch: 0, heading: 0 }, { duration: o!.duration! });
        setTimeout(fit, o!.duration! + 150);
        return;
      }
      fit();
    }
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
        ? { initialCamera: { center: { latitude: initial.center[1], longitude: initial.center[0] }, altitude: GLOBE_ALTITUDE_M, pitch: 0, heading: 0, zoom: 1 } }
        : { initialRegion: region(initial.center, initial.zoom) })}
      mapType={globe && Platform.OS === "ios" ? "hybridFlyover" : mapType === "satellite" || (mapType === "auto" && far) ? "hybrid" : "standard"}
      mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
      userInterfaceStyle={isDark ? "dark" : "light"}
      showsPointsOfInterests={false}
      showsBuildings
      pitchEnabled={false}
      toolbarEnabled={false}
      onMapReady={onReady}
      onPress={onMapPress}
      onPanDrag={onUserMove}
      onRegionChangeComplete={(r) => {
        shown.current = r;
        const zoom = zoomOf(r);
        onZoom(zoom);
        setFar(zoom < 6.5);
        onBounds?.([r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2]);
      }}
    >
      {lines.map((l) => (
        <Polyline key={l.key} coordinates={l.coords} strokeColor="rgba(19,108,53,0.45)" strokeWidth={3} />
      ))}
      {(vehicles.features as VehicleFeature[])
        .filter((f) => f.geometry?.type === "Point" && f.properties?.deviceId)
        .map((f) => {
          const on = f.properties.deviceId === selectedId;
          return (
            <GlideMarker
              key={f.properties.deviceId}
              id={f.properties.deviceId}
              lat={f.geometry.coordinates[1]!}
              lng={f.geometry.coordinates[0]!}
              rot={top ? (f.properties.rot ?? 0) : 0}
              image={MAP_ICONS[f.properties.pin]}
              shape={top ? "top" : isPin ? "pin" : "round"}
              color={f.properties.color ?? colors.primary}
              selected={on}
              bubble={on ? (bubble ?? null) : null}
              onSelect={onSelect}
            />
          );
        })}
    </MapView>
  );
});

const SIZE = { top: { width: 38, height: 60 }, pin: { width: 42, height: 52 }, round: { width: 44, height: 48 } } as const;

/**
 * One vehicle on the phone's own map. It glides from its last reported position to the new one
 * and turns to its heading the short way round, instead of jumping; it only ever moves between
 * positions the tracker really reported.
 */
const GlideMarker = memo(function GlideMarker({
  id,
  lat,
  lng,
  rot,
  image,
  shape,
  color,
  selected,
  bubble,
  onSelect
}: {
  id: string;
  lat: number;
  lng: number;
  rot: number;
  image: ImageSourcePropType | undefined;
  shape: "top" | "pin" | "round";
  color: string;
  selected: boolean;
  bubble: string | null;
  onSelect: (deviceId: string) => void;
}) {
  const at = useRef(new AnimatedRegion({ latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0 })).current;
  const turn = useRef(new Animated.Value(rot)).current;
  const turned = useRef(rot);
  const placed = useRef({ lat, lng });

  useEffect(() => {
    if (placed.current.lat === lat && placed.current.lng === lng) return;
    // A big leap (the tracker was silent for a while) is shown at once; a normal step glides.
    const leap = Math.abs(lat - placed.current.lat) > 0.05 || Math.abs(lng - placed.current.lng) > 0.05;
    placed.current = { lat, lng };
    at.stopAnimation(() => undefined);
    at.timing({ latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0, toValue: 0, duration: leap ? 0 : GLIDE_MS, easing: Easing.linear, useNativeDriver: false }).start();
  }, [lat, lng, at]);

  useEffect(() => {
    // Turn the short way: from 350° to 10° is +20°, not -340°.
    const delta = ((((rot - turned.current) % 360) + 540) % 360) - 180;
    if (delta === 0) return;
    turned.current += delta;
    Animated.timing(turn, { toValue: turned.current, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [rot, turn]);

  const size = SIZE[shape];
  const box = Math.max(size.width, size.height) + (selected ? 30 : 12);
  const spin = turn.interpolate({ inputRange: [-360, 360], outputRange: ["-360deg", "360deg"], extrapolate: "extend" });
  return (
    <MarkerAnimated
      identifier={id}
      // AnimatedRegion is what MarkerAnimated moves; its type asks for a plain coordinate.
      coordinate={at as unknown as { latitude: number; longitude: number }}
      // Apple Maps centres the view on the point; a pin has to stand on it instead.
      anchor={shape === "pin" ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
      centerOffset={shape === "pin" ? { x: 0, y: -size.height / 2 } : { x: 0, y: bubble ? -17 : 0 }}
      zIndex={selected ? 10 : 1}
      tracksViewChanges
      onPress={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
    >
      <View style={styles.stack} pointerEvents="none">
        {bubble ? (
          <View style={styles.bubble}>
            <Ionicons name="speedometer-outline" size={13} color={color} />
            <Text style={styles.bubbleText} numberOfLines={1}>{bubble}</Text>
          </View>
        ) : null}
        <View style={[styles.box, { width: box, height: box }]}>
          {shape !== "pin" ? <View style={[styles.glow, { width: box, height: box, borderRadius: box / 2, backgroundColor: color, opacity: selected ? 0.28 : 0.14 }]} /> : null}
          {image ? <Animated.Image source={image} style={[size, { transform: [{ rotate: spin }, { scale: selected ? 1.2 : 1 }] }]} resizeMode="contain" /> : null}
        </View>
      </View>
    </MarkerAnimated>
  );
});

const styles = themed(() => ({
  stack: { alignItems: "center" as const },
  box: { alignItems: "center" as const, justifyContent: "center" as const },
  glow: { position: "absolute" as const },
  bubble: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, height: 28, marginBottom: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.background, ...elevation.md },
  bubbleText: { fontSize: 13, lineHeight: 17, fontWeight: "800" as const, color: colors.foreground, fontVariant: ["tabular-nums" as const] }
}));
