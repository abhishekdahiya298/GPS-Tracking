import { Ionicons } from "@expo/vector-icons";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType } from "react-native";
import MapView, { AnimatedRegion, Marker, MarkerAnimated, Polyline, type Region } from "react-native-maps";
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

type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, { deviceId: string; pin: string; rot?: number; name?: string; sub?: string; color?: string }>;

/** Which map to draw: the street map (default) or satellite photos. */
export type NativeMapType = "street" | "satellite";
/** Camera height for the opening: far enough that the whole Earth fits on a phone held upright. */
const GLOBE_ALTITUDE_M = 42_000_000;
/** How long a vehicle takes to glide from one reported position to the next. */
const GLIDE_MS = 1000;
/** Above this many vehicles in view, close ones are grouped into numbered circles. */
const MAX_MARKERS = 120;
/** Zoomed far out, vehicles become dots only when more than this many are in view. */
const DOTS_FROM = 25;
/** Name tags beside photo pins only while no more than this many vehicles are in view. */
const LABELS_UP_TO = 30;

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
    /** iPhone only: start as the whole 3D Earth until the opening descent to the fleet ends. */
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
>(function NativeLiveMap({ vehicles, trails, selectedId, prefs, bottomInset, topInset, initial, globe = false, mapType = "street", bubble, onBounds, onSelect, onMapPress, onReady, onZoom, onUserMove }, ref) {
  const map = useRef<MapView>(null);
  const { width, height } = useWindowDimensions();
  const isPin = prefs.style === "pin" || prefs.style === "photo";
  const photo = prefs.style === "photo";
  const top = prefs.style === "top";
  // Started as the globe? Fixed at first render so the camera props never reset the view.
  const startedAsGlobe = useRef(globe && Platform.OS === "ios").current;
  const shown = useRef<Region | null>(null);
  const diving = useRef(startedAsGlobe);
  const [far, setFar] = useState(false);
  // Zoomed out over a country or more: vehicles become small status dots, so they don't pile up.
  const [zoomedOut, setDots] = useState(false);

  const region = (center: [number, number], zoom: number): Region => {
    const lngDelta = (360 / 2 ** zoom) * (width / 256);
    return { latitude: center[1], longitude: center[0], longitudeDelta: lngDelta, latitudeDelta: lngDelta * (height / width) };
  };

  // A hop to somewhere well off the screen: flying straight there crosses map that is not
  // loaded yet (a blank, beige screen). Instead the camera rises until both places fit (those
  // wider tiles load at once), then comes down on the new place, like Life360.
  const hop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goTo = (target: Region | null, center: [number, number], duration: number | undefined) => {
    if (hop.current) clearTimeout(hop.current);
    const r = shown.current;
    const d = duration ?? 600;
    const land = () => (target ? map.current?.animateToRegion(target, Math.max(d, 700)) : map.current?.animateCamera({ center: { latitude: center[1], longitude: center[0] } }, { duration: Math.max(d, 700) }));
    if (!r) return void land();
    const away = Math.max(Math.abs(center[0] - r.longitude) / Math.max(r.longitudeDelta, 1e-6), Math.abs(center[1] - r.latitude) / Math.max(r.latitudeDelta, 1e-6));
    if (away <= 1.5) {
      if (target) map.current?.animateToRegion(target, d);
      else map.current?.animateCamera({ center: { latitude: center[1], longitude: center[0] } }, { duration: d });
      return;
    }
    const lngSpan = Math.abs(center[0] - r.longitude) * 1.6 + r.longitudeDelta;
    const latSpan = Math.abs(center[1] - r.latitude) * 1.6 + r.latitudeDelta;
    const span = Math.min(Math.max(lngSpan, latSpan * (width / height)), 300);
    map.current?.animateToRegion({ latitude: (center[1] + r.latitude) / 2, longitude: (center[0] + r.longitude) / 2, longitudeDelta: span, latitudeDelta: span * (height / width) }, 650);
    hop.current = setTimeout(land, 700);
  };

  useImperativeHandle(ref, () => ({
    flyTo: ({ center, zoom, duration }) => goTo(region(center, zoom ?? 14), center, duration),
    easeTo: ({ center, zoom, duration }) => goTo(zoom === undefined ? null : region(center, zoom), center, duration),
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

  // Large fleets: only vehicles in or near the view get a marker, and where many would pile up
  // (more than MAX_MARKERS in view) close ones are drawn as one numbered circle. The chosen vehicle
  // is always drawn on its own. Recomputed when the view settles, not on every frame.
  const [view, setView] = useState<Region | null>(null);
  const placed = useMemo(() => {
    const all = (vehicles.features as VehicleFeature[]).filter((f) => f.geometry?.type === "Point" && f.properties?.deviceId);
    if (!view || all.length <= MAX_MARKERS) return { singles: all, groups: [] as { key: string; lat: number; lng: number; count: number }[] };
    const w = view.longitude - view.longitudeDelta, e = view.longitude + view.longitudeDelta;
    const s0 = view.latitude - view.latitudeDelta, n = view.latitude + view.latitudeDelta;
    const near = all.filter((f) => {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      return f.properties.deviceId === selectedId || (lng >= w && lng <= e && lat >= s0 && lat <= n);
    });
    if (near.length <= MAX_MARKERS) return { singles: near, groups: [] };
    // A grid of about 56 points on screen: vehicles sharing a cell become one group.
    const cellLng = (view.longitudeDelta / width) * 56, cellLat = (view.latitudeDelta / height) * 56;
    const cells = new globalThis.Map<string, VehicleFeature[]>();
    for (const f of near) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const k = `${Math.floor(lng / cellLng)}:${Math.floor(lat / cellLat)}`;
      const list = cells.get(k);
      if (list) list.push(f);
      else cells.set(k, [f]);
    }
    const singles: VehicleFeature[] = [];
    const groups: { key: string; lat: number; lng: number; count: number }[] = [];
    for (const [k, list] of cells) {
      const keep = list.filter((f) => f.properties.deviceId === selectedId);
      const rest = list.filter((f) => f.properties.deviceId !== selectedId);
      singles.push(...keep);
      if (rest.length === 1) singles.push(rest[0]!);
      else if (rest.length > 1) {
        const lat = rest.reduce((t, f) => t + (f.geometry.coordinates[1] ?? 0), 0) / rest.length;
        const lng = rest.reduce((t, f) => t + (f.geometry.coordinates[0] ?? 0), 0) / rest.length;
        groups.push({ key: `g${k}`, lat, lng, count: rest.length });
      }
    }
    return { singles, groups };
  }, [vehicles, view, selectedId, width, height]);

  // Dots only when they help: far out AND enough vehicles in view that pictures would pile up.
  // A small fleet keeps its vehicle pictures at every zoom.
  const dots = zoomedOut && placed.singles.length > DOTS_FROM;
  // Photo pins carry a name tag beside them (like Life360) while there is room for it.
  const showLabels = photo && !dots && !far && placed.singles.length <= LABELS_UP_TO;

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
      // Zoomed far out the street map is the round 3D Earth in the app's light or dark colours.
      // Satellite is Apple's photo Earth (which shows real night).
      // The opening Earth uses the street map too (the build turns on Apple's realistic style for
      // it, see plugins/with-apple-globe.js), so it is light or dark like the app.
      mapType={mapType === "satellite" && !globe ? (Platform.OS === "ios" && far ? "hybridFlyover" : "hybrid") : "standard"}
      mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
      userInterfaceStyle={isDark ? "dark" : "light"}
      showsPointsOfInterests={false}
      showsBuildings
      pitchEnabled={false}
      toolbarEnabled={false}
      onMapReady={onReady}
      // On iPhone a tap on a vehicle also reaches the map; that one must not close the vehicle.
      onPress={(e) => {
        if ((e.nativeEvent as { action?: string }).action === "marker-press") return;
        onMapPress();
      }}
      onPanDrag={onUserMove}
      onRegionChangeComplete={(r) => {
        shown.current = r;
        setView(r);
        const zoom = zoomOf(r);
        onZoom(zoom);
        setFar(zoom < 6.5);
        setDots(zoom < 5.5);
        onBounds?.([r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2]);
      }}
    >
      {lines.map((l) => (
        <Polyline key={l.key} coordinates={l.coords} strokeColor="rgba(19,108,53,0.45)" strokeWidth={3} />
      ))}
      {placed.singles.map((f) => {
        const on = f.properties.deviceId === selectedId;
        return (
          <GlideMarker
            key={f.properties.deviceId}
            id={f.properties.deviceId}
            lat={f.geometry.coordinates[1]!}
            lng={f.geometry.coordinates[0]!}
            rot={top ? (f.properties.rot ?? 0) : 0}
            image={MAP_ICONS[f.properties.pin]}
            shape={top ? "top" : photo ? "photo" : isPin ? "pin" : "round"}
            label={showLabels && !on ? { name: f.properties.name ?? "", line: f.properties.sub ?? "" } : null}
            color={f.properties.color ?? colors.primary}
            selected={on}
            dot={dots && !on}
            bubble={on && !dots ? (bubble ?? null) : null}
            onSelect={onSelect}
          />
        );
      })}
      {placed.groups.map((g) => (
        <Marker
          key={g.key}
          coordinate={{ latitude: g.lat, longitude: g.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={(e) => {
            e.stopPropagation();
            // Open the group: zoom in until its vehicles separate.
            const r = shown.current;
            const span = (r?.longitudeDelta ?? 10) / 4;
            map.current?.animateToRegion({ latitude: g.lat, longitude: g.lng, longitudeDelta: span, latitudeDelta: span * (height / width) }, 500);
          }}
        >
          <View style={styles.cluster} accessibilityLabel={`${g.count} vehicles here`}>
            <Text style={styles.clusterText}>{g.count}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
});

// Life360-sized: big enough to read the vehicle and its colour, small enough not to cover the road.
const SIZE = { top: { width: 28, height: 44 }, photo: { width: 44, height: 49 }, pin: { width: 34, height: 42 }, round: { width: 36, height: 40 } } as const;

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
  dot,
  bubble,
  label,
  onSelect
}: {
  id: string;
  lat: number;
  lng: number;
  rot: number;
  image: ImageSourcePropType | undefined;
  shape: "top" | "photo" | "pin" | "round";
  label?: { name: string; line: string } | null;
  color: string;
  selected: boolean;
  dot: boolean;
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
  // Pins stand on their point; the others sit centred on it.
  const standing = shape === "pin" || shape === "photo";
  const box = Math.max(size.width, size.height) + (selected ? 24 : 8);
  const frame = standing ? { width: size.width, height: size.height } : { width: box, height: box };
  const spin = turn.interpolate({ inputRange: [-360, 360], outputRange: ["-360deg", "360deg"], extrapolate: "extend" });
  return (
    <MarkerAnimated
      identifier={id}
      // AnimatedRegion is what MarkerAnimated moves; its type asks for a plain coordinate.
      coordinate={at as unknown as { latitude: number; longitude: number }}
      // Apple Maps centres the view on the point; a pin has to stand on it instead.
      anchor={standing && !dot ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
      centerOffset={standing && !dot ? { x: 0, y: -size.height / 2 } : { x: 0, y: bubble ? -17 : 0 }}
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
        {dot ? (
          <View style={[styles.dot, { backgroundColor: color }]} />
        ) : (
        <View style={[styles.box, frame]}>
          {!standing ? <View style={[styles.glow, { width: box, height: box, borderRadius: box / 2, backgroundColor: color, opacity: selected ? 0.28 : 0.14 }]} /> : null}
          {label ? (
            <View style={[styles.tag, { left: size.width - 6 }]}>
              <Text style={styles.tagName} numberOfLines={1}>{label.name}</Text>
              {label.line ? <Text style={[styles.tagLine, { color }]} numberOfLines={1}>{label.line}</Text> : null}
            </View>
          ) : null}
          {image ? <Animated.Image source={image} style={[size, { transform: [{ rotate: spin }, { scale: selected ? 1.25 : 1 }] }]} resizeMode="contain" /> : null}
        </View>
        )}
      </View>
    </MarkerAnimated>
  );
});

const styles = themed(() => ({
  stack: { alignItems: "center" as const },
  box: { alignItems: "center" as const, justifyContent: "center" as const },
  glow: { position: "absolute" as const },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: "#ffffff", ...elevation.sm },
  cluster: { minWidth: 34, height: 34, paddingHorizontal: 8, borderRadius: 17, borderWidth: 3, borderColor: "#ffffff", backgroundColor: colors.primary, alignItems: "center" as const, justifyContent: "center" as const, ...elevation.md },
  clusterText: { fontSize: 13, fontWeight: "800" as const, color: "#ffffff", fontVariant: ["tabular-nums" as const] },
  tag: { position: "absolute" as const, top: 4, maxWidth: 150, paddingLeft: 10, paddingRight: 9, paddingVertical: 3, borderTopRightRadius: 12, borderBottomRightRadius: 12, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: colors.background, ...elevation.sm },
  tagName: { fontSize: 12, lineHeight: 15, fontWeight: "800" as const, color: colors.foreground },
  tagLine: { fontSize: 11, lineHeight: 14, fontWeight: "700" as const },
  bubble: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, height: 28, marginBottom: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.background, ...elevation.md },
  bubbleText: { fontSize: 13, lineHeight: 17, fontWeight: "800" as const, color: colors.foreground, fontVariant: ["tabular-nums" as const] }
}));
