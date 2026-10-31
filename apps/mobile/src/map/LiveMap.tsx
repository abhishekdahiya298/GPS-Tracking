import { Ionicons } from "@expo/vector-icons";
import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type GeoJSONSourceRef, type PressEventWithFeatures } from "@maplibre/maplibre-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, countByFilter, displayName, fleetState, statusLine } from "@/fleet/model";
import { colors, font, radius, space } from "@/theme";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL, boundsOf, positionOf, readTap, toFeatures } from "./model";

const FIT_PADDING = { top: 90, right: 50, bottom: 200, left: 50 };
const FOLLOW_ZOOM = 14;

/**
 * The live map. Vehicles are drawn by the map engine itself (circles and labels from one GeoJSON
 * source), not as React views, so hundreds of vehicles stay smooth. Nearby vehicles group into a
 * numbered circle when zoomed out.
 */
export default function LiveMap() {
  const router = useRouter();
  const params = useLocalSearchParams<{ device?: string }>();
  const { devices, loading, error, units } = useFleet();
  const now = useNow();
  const camera = useRef<CameraRef>(null);
  const source = useRef<GeoJSONSourceRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const fitted = useRef(false);
  // A tap on a vehicle must not also count as a tap on empty map (which closes the card).
  const vehicleTapAt = useRef(0);

  const data = useMemo(() => toFeatures(devices), [devices]);
  const counts = useMemo(() => countByFilter(devices), [devices]);
  const selected = devices.find((d) => d.deviceId === selectedId);
  const selectedAt = positionOf(selected);

  const fitAll = useCallback(() => {
    const bounds = boundsOf(devices);
    if (bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 600 });
  }, [devices]);

  // First positions: show the whole fleet once. After that the camera is the person's to move.
  useEffect(() => {
    if (!mapReady || fitted.current || params.device) return;
    const bounds = boundsOf(devices);
    if (!bounds) return;
    fitted.current = true;
    camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 0 });
  }, [mapReady, devices, params.device]);

  // Opened from a vehicle's "Show on map": select it and follow it.
  useEffect(() => {
    if (!mapReady || !params.device) return;
    const at = positionOf(devices.find((d) => d.deviceId === params.device));
    if (!at) return;
    fitted.current = true;
    setSelectedId(params.device);
    setFollowing(true);
    camera.current?.flyTo({ center: at, zoom: FOLLOW_ZOOM, duration: 800 });
    router.setParams({ device: undefined });
  }, [mapReady, params.device, devices, router]);

  // Follow mode: keep the selected vehicle centred as new positions arrive.
  const lng = selectedAt?.[0];
  const lat = selectedAt?.[1];
  useEffect(() => {
    if (following && lng !== undefined && lat !== undefined) camera.current?.easeTo({ center: [lng, lat], duration: 1000 });
  }, [following, lng, lat]);

  const onVehiclesPress = useCallback(async (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    const tap = readTap(event.nativeEvent.features);
    if (tap.kind !== "none") vehicleTapAt.current = Date.now();
    if (tap.kind === "vehicle") {
      setSelectedId(tap.deviceId);
      setFollowing(false);
    } else if (tap.kind === "cluster") {
      // Zoom in just far enough for the group to split.
      const zoom = await source.current?.getClusterExpansionZoom(tap.clusterId).catch(() => null);
      camera.current?.easeTo({ center: tap.at, zoom: (zoom ?? 12) + 0.5, duration: 500 });
    }
  }, []);

  function toggleFollow() {
    if (!selectedAt) return;
    if (!following) camera.current?.flyTo({ center: selectedAt, zoom: FOLLOW_ZOOM, duration: 700 });
    setFollowing(!following);
  }

  const meta = selected ? STATE_META[fleetState(selected)] : null;

  return (
    <View style={styles.wrap}>
      <Map
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        compass
        compassPosition={{ top: 64, left: 12 }}
        touchPitch={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onDidFailLoadingMap={() => setMapFailed(true)}
        // Dragging the map by hand ends follow mode, as on the website.
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) setFollowing(false);
        }}
        onPress={() => {
          if (Date.now() - vehicleTapAt.current > 400) setSelectedId(null);
        }}
      >
        <Camera ref={camera} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} maxZoom={18} />
        <GeoJSONSource id="vehicles" ref={source} data={data} cluster clusterRadius={45} clusterMaxZoom={13} onPress={onVehiclesPress} hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}>
          <Layer id="clusters" type="circle" filter={["has", "point_count"]} paint={{ "circle-color": colors.primary, "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 28], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }} />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{ "text-field": ["to-string", ["get", "point_count"]], "text-font": ["Noto Sans Bold"], "text-size": 14, "text-allow-overlap": true }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="vehicle-selected"
            type="circle"
            filter={["all", ["!", ["has", "point_count"]], ["==", ["get", "deviceId"], selectedId ?? ""]]}
            paint={{ "circle-radius": 18, "circle-color": ["get", "color"], "circle-opacity": 0.25 }}
          />
          <Layer id="vehicle-dots" type="circle" filter={["!", ["has", "point_count"]]} paint={{ "circle-radius": 9, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 }} />
          <Layer
            id="vehicle-names"
            type="symbol"
            minzoom={9}
            filter={["!", ["has", "point_count"]]}
            layout={{ "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true }}
            paint={{ "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
          />
        </GeoJSONSource>
      </Map>

      <View style={styles.summary} pointerEvents="none">
        {(["moving", "idle", "stopped", "offline"] as const).map((key) => (
          <View key={key} style={styles.summaryItem}>
            <View style={[styles.dot, { backgroundColor: STATE_META[key].color }]} />
            <Text style={styles.summaryText}>{counts[key]}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={fitAll} style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.muted }]} accessibilityRole="button" accessibilityLabel="Show all vehicles">
        <Ionicons name="scan-outline" size={22} color={colors.primary} />
      </Pressable>

      {loading || !mapReady ? (
        <View style={styles.notice} pointerEvents="none">
          {mapFailed ? <Text style={styles.noticeText}>The map could not load. Check your connection.</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : error ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>Showing the last update. {error}</Text>
        </View>
      ) : data.features.length === 0 ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>No vehicle has reported a position yet.</Text>
        </View>
      ) : null}

      {selected && meta ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.flex}>
              <Text style={styles.cardName} numberOfLines={1}>{displayName(selected)}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{statusLine(selected, units.fmtSpeed, now)}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: meta.soft }]}>
              <View style={[styles.dot, { backgroundColor: meta.color }]} />
              <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            <Pressable onPress={() => setSelectedId(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={styles.cardActions}>
            <Pressable onPress={toggleFollow} style={[styles.action, following && styles.actionOn]} accessibilityRole="button" accessibilityState={{ selected: following }}>
              <Ionicons name={following ? "navigate" : "navigate-outline"} size={18} color={following ? colors.primaryForeground : colors.primary} />
              <Text style={[styles.actionText, following && { color: colors.primaryForeground }]}>{following ? "Following" : "Follow"}</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: selected.deviceId } })} style={styles.action} accessibilityRole="button">
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.actionText}>Details</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const shadow = { shadowColor: "#101828", shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 };
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  map: { flex: 1 },
  flex: { flex: 1 },
  summary: { position: "absolute", top: space.md, left: space.md, flexDirection: "row", gap: space.md, backgroundColor: colors.background, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, ...shadow },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryText: { fontSize: font.small, fontWeight: "600", color: colors.foreground },
  dot: { width: 9, height: 9, borderRadius: 5 },
  fab: { position: "absolute", top: space.md, right: space.md, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", ...shadow },
  notice: { position: "absolute", top: 68, alignSelf: "center", maxWidth: "86%", backgroundColor: colors.background, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, ...shadow },
  noticeText: { fontSize: font.small, color: colors.foreground, textAlign: "center" },
  card: { position: "absolute", left: space.md, right: space.md, bottom: space.md, backgroundColor: colors.background, borderRadius: radius.xl, padding: space.lg, gap: space.md, ...shadow },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  cardName: { fontSize: font.title, fontWeight: "700", color: colors.foreground },
  cardSub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 12, fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontSize: font.body, fontWeight: "600", color: colors.primary }
});
