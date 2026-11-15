import { Ionicons } from "@expo/vector-icons";
import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef, type GeoJSONSourceRef, type PressEventWithFeatures } from "@maplibre/maplibre-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api";
import { AddressCard, Chip, FactTile, SpeedBar, StatusPill, VehiclePicture } from "@/components/kit";
import { Dots, FadeIn, PressableScale, PulseDot, SlideUp } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, coordsText, countByFilter, displayName, fleetState, freshnessLine, selectDevices, sheetFacts, sheetHeadline, type FleetFilter } from "@/fleet/model";
import { haptic } from "@/haptics";
import { colors, elevation, font, isDark, radius, size, space, type } from "@/theme";
import { FleetSheet } from "./FleetSheet";
import { GlobeIntro } from "./GlobeIntro";
import { DEFAULT_CENTER, DEFAULT_ZOOM, DETAIL_ZOOM, WORLD_VIEW, FOCUS_ZOOM, MAP_STYLES, focusZoom, boundsOf, isMapStyleId, positionOf, readTap, styleUrl, zoneFeatures, type MapStyleId, type Zone } from "./model";
import { PIN_IMAGES } from "./sprites";

/** Movement trails only once the map is close enough for them to read as roads. */
const TRAIL_ZOOM = 11;
import { useGlide } from "./useGlide";

const FIT_PADDING = { top: 190, right: 50, bottom: 240, left: 50 };
const FOLLOW_ZOOM = FOCUS_ZOOM;
const STYLE_KEY = "rio.map-style";
const NOT_CLUSTER: ["!", ["has", string]] = ["!", ["has", "point_count"]];
// The dive from space is shown once each time the app is opened, not on every visit to the tab.
let introPlayed = false;

/**
 * The live map. Vehicles are drawn by the map engine itself (pictures, dots and labels from one
 * GeoJSON source), not as React views, so hundreds of vehicles stay smooth. It follows the
 * website's map: status dots when zoomed out, small top-down vehicles that turn with the road
 * when zoomed in, a short trail behind moving vehicles, zones, and a choice of base map.
 */
export default function LiveMap() {
  const router = useRouter();
  const params = useLocalSearchParams<{ device?: string }>();
  const { devices, loading, error, units, connection } = useFleet();
  const now = useNow();
  const camera = useRef<CameraRef>(null);
  const source = useRef<GeoJSONSourceRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [listOpen, setListOpen] = useState(false);
  const [style, setStyle] = useState<MapStyleId>(isDark ? "dark" : "streets");
  const [styleMenu, setStyleMenu] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const insets = useSafeAreaInsets();
  // The selected-vehicle card's height, so the round buttons can sit just above it.
  const [cardHeight, setCardHeight] = useState(0);
  const fitted = useRef(false);
  const [intro, setIntro] = useState(false);
  const diveTo = useRef<ReturnType<typeof boundsOf>>(null);
  // A tap on a vehicle must not also count as a tap on empty map (which closes the card).
  const vehicleTapAt = useRef(0);
  // How far in the map is right now, and the latest fleet, for use inside tap handlers.
  const zoomNow = useRef<number | null>(null);
  const devicesNow = useRef(devices);
  devicesNow.current = devices;

  // The status filter narrows the map exactly as it narrows the list.
  const visible = useMemo(() => (filter === "all" ? devices : selectDevices(devices, filter, "")), [devices, filter]);
  const { vehicles, trails } = useGlide(visible, units.fmtSpeed);
  const zoneData = useMemo(() => zoneFeatures(zones), [zones]);
  const counts = useMemo(() => countByFilter(devices), [devices]);
  const selected = devices.find((d) => d.deviceId === selectedId);
  // The vehicles the arrows on the card step through: the ones on the map now, in list order.
  const steps = useMemo(() => selectDevices(visible, "all", "").filter((d) => positionOf(d)), [visible]);
  const stepIndex = steps.findIndex((d) => d.deviceId === selectedId);
  const selectedAt = positionOf(selected);
  const dark = style === "dark";

  // The base map the person picked last time, and the organization's zones. Both are optional:
  // without them the map still works.
  useEffect(() => {
    SecureStore.getItemAsync(STYLE_KEY)
      .then((saved) => {
        if (isMapStyleId(saved)) setStyle(saved);
      })
      .catch(() => undefined);
    api
      .get<{ geofences?: Zone[] }>("geofences")
      .then((body) => {
        if (Array.isArray(body.geofences)) setZones(body.geofences);
      })
      .catch(() => undefined);
  }, []);

  function pickStyle(id: MapStyleId) {
    haptic.tap();
    setStyleMenu(false);
    if (id === style) return;
    setStyle(id);
    SecureStore.setItemAsync(STYLE_KEY, id).catch(() => undefined);
  }

  const fitAll = useCallback(() => {
    const bounds = boundsOf(visible);
    if (bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 600 });
  }, [visible]);

  // First positions: show the whole fleet once. After that the camera is the person's to move.
  useEffect(() => {
    if (!mapReady || fitted.current || params.device) return;
    const bounds = boundsOf(devices);
    if (!bounds) return;
    fitted.current = true;
    if (introPlayed) {
      camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 0 });
      return;
    }
    // First visit since the app opened: start from the whole Earth and dive to the fleet.
    introPlayed = true;
    diveTo.current = bounds;
    setIntro(true);
  }, [mapReady, devices, params.device]);

  const dive = useCallback(() => {
    if (diveTo.current) camera.current?.fitBounds(diveTo.current, { padding: FIT_PADDING, duration: 2200, easing: "fly" });
  }, []);
  const endIntro = useCallback(() => setIntro(false), []);

  const focus = useCallback(
    (deviceId: string) => {
      const at = positionOf(devices.find((d) => d.deviceId === deviceId));
      setFilter("all");
      setSelectedId(deviceId);
      if (!at) return;
      fitted.current = true;
      setFollowing(true);
      camera.current?.flyTo({ center: at, zoom: FOLLOW_ZOOM, duration: 800 });
    },
    [devices]
  );

  // Opened from a vehicle's "Show on map": select it and follow it.
  useEffect(() => {
    if (!mapReady || !params.device) return;
    if (!devices.some((d) => d.deviceId === params.device)) return;
    focus(params.device);
    router.setParams({ device: undefined });
  }, [mapReady, params.device, devices, router, focus]);

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
      haptic.tap();
      setSelectedId(tap.deviceId);
      setFollowing(false);
      // Bring the vehicle to the middle and come in close enough to see its road.
      const at = positionOf(devicesNow.current.find((d) => d.deviceId === tap.deviceId));
      if (at) camera.current?.flyTo({ center: at, zoom: focusZoom(zoomNow.current), duration: 700 });
    } else if (tap.kind === "cluster") {
      // Zoom in just far enough for the group to split.
      const zoom = await source.current?.getClusterExpansionZoom(tap.clusterId).catch(() => null);
      camera.current?.easeTo({ center: tap.at, zoom: (zoom ?? 12) + 0.5, duration: 500 });
    }
  }, []);

  /** The arrows on the card: go to the previous or next vehicle and bring it to the middle. */
  function step(by: number) {
    if (steps.length === 0) return;
    const next = steps[(Math.max(stepIndex, 0) + by + steps.length) % steps.length];
    if (!next) return;
    setSelectedId(next.deviceId);
    setFollowing(false);
    const at = positionOf(next);
    if (at) camera.current?.flyTo({ center: at, zoom: focusZoom(zoomNow.current), duration: 600 });
  }

  function toggleFollow() {
    if (!selectedAt) return;
    haptic.press();
    if (!following) camera.current?.flyTo({ center: selectedAt, zoom: FOLLOW_ZOOM, duration: 700 });
    setFollowing(!following);
  }

  function openInMaps() {
    if (!selected || !selectedAt) return;
    const at = `${selectedAt[1]},${selectedAt[0]}`;
    const label = encodeURIComponent(displayName(selected));
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${at}&q=${label}` : `geo:${at}?q=${at}(${label})`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${at}`));
  }

  const labelColor = dark ? "#ffffff" : "#0f172a";
  const labelHalo = dark ? "#0b1220" : "#ffffff";
  const selectedState = selected ? fleetState(selected) : null;
  const loc = selected?.location;
  const facts = selected ? sheetFacts(selected, now) : null;
  const headline = selected ? sheetHeadline(selected, now) : { title: "", detail: "" };
  const speedText = ((): [string, string] => {
    if (!selected || selectedState === "offline" || selectedState === "never_seen") return ["—", ""];
    const t = units.fmtSpeed(selectedState === "moving" ? (loc?.speedKph ?? null) : 0);
    const i = t.lastIndexOf(" ");
    return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 1)];
  })();

  return (
    <View style={styles.wrap}>
      <Map
        style={styles.map}
        mapStyle={styleUrl(style)}
        logo={false}
        compass
        compassPosition={{ top: insets.top + 116, left: 12 }}
        touchPitch={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onDidFailLoadingMap={() => setMapFailed(true)}
        // Dragging the map by hand ends follow mode, as on the website.
        onRegionDidChange={(e) => {
          zoomNow.current = e.nativeEvent.zoom;
        }}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) setFollowing(false);
        }}
        onPress={() => {
          setStyleMenu(false);
          if (Date.now() - vehicleTapAt.current > 400) setSelectedId(null);
        }}
      >
        <Camera ref={camera} initialViewState={introPlayed || params.device ? { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM } : WORLD_VIEW} maxZoom={18} />
        <Images images={PIN_IMAGES} />

        <GeoJSONSource id="zones" data={zoneData}>
          <Layer id="zone-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.12 }} />
          <Layer id="zone-edge" type="line" paint={{ "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.8 }} />
          <Layer
            id="zone-names"
            type="symbol"
            minzoom={10}
            layout={{ "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-optional": true }}
            paint={{ "text-color": ["get", "color"], "text-halo-color": labelHalo, "text-halo-width": 1.5 }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="trails" data={trails}>
          <Layer id="trail-lines" type="line" minzoom={TRAIL_ZOOM} layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": STATE_META.moving.color, "line-width": 3, "line-opacity": 0.35 }} />
        </GeoJSONSource>

        <GeoJSONSource id="vehicles" ref={source} data={vehicles} cluster clusterRadius={42} clusterMaxZoom={9} onPress={onVehiclesPress} hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}>
          <Layer id="clusters" type="circle" filter={["has", "point_count"]} paint={{ "circle-color": colors.primary, "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25, 200, 30], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }} />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{ "text-field": ["to-string", ["get", "point_count"]], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="vehicle-selected"
            type="circle"
            filter={["all", NOT_CLUSTER, ["==", ["get", "deviceId"], selectedId ?? ""]]}
            // A soft blue glow behind the pin's head (the pin stands on the point, so its head is ~28 px up).
            paint={{ "circle-radius": 28, "circle-color": colors.primary, "circle-opacity": 0.2, "circle-blur": 0.4, "circle-translate": [0, -28] }}
          />
          {/* Zoomed out: a small status dot each, so a large fleet stays readable. */}
          <Layer
            id="vehicle-dots"
            type="circle"
            maxzoom={DETAIL_ZOOM}
            filter={NOT_CLUSTER}
            paint={{ "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 6.5], "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }}
          />
          {/* Zoomed in: a 3D pin in the status colour; a moving pin's badge points the way it drives. */}
          <Layer
            id="vehicle-pictures"
            type="symbol"
            minzoom={DETAIL_ZOOM}
            filter={NOT_CLUSTER}
            layout={{
              "icon-image": ["get", "pin"],
              "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.27, 12, 0.33, 16, 0.38],
              "icon-anchor": "bottom",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true
            }}
          />
          <Layer
            id="vehicle-names"
            type="symbol"
            minzoom={12}
            filter={NOT_CLUSTER}
            layout={{
              "text-field": ["format", ["get", "name"], { "font-scale": 1 }, "\n", {}, ["get", "sub"], { "font-scale": 0.85 }],
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-line-height": 1.2,
              "text-offset": [0, 0.6],
              "text-anchor": "top",
              "text-optional": true
            }}
            paint={{ "text-color": labelColor, "text-halo-color": labelHalo, "text-halo-width": 1.6 }}
          />
        </GeoJSONSource>
      </Map>

      {/* Top: search (opens the fleet list) and the status chips. */}
      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <PressableScale onPress={() => setListOpen(true)} style={styles.search} scaleTo={0.985} accessibilityRole="button" accessibilityLabel="Find a vehicle">
          <Ionicons name="search" size={size.icon} color={colors.mutedForeground} />
          <Text style={styles.searchText}>Find a vehicle</Text>
          <View style={styles.live}>
            <PulseDot size={7} color={connection === "live" ? colors.success : colors.warning} live={connection === "live"} />
            <Text style={[styles.liveText, { color: connection === "live" ? colors.success : colors.warning }]}>{connection === "live" ? "Live" : error ? "Offline" : "Updating"}</Text>
          </View>
        </PressableScale>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} count={counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} glyph={f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>
      </View>

      {loading || !mapReady ? (
        <View style={[styles.notice, { top: insets.top + 116 }]} pointerEvents="none">
          {mapFailed ? <Text style={styles.noticeText}>The map could not load. Check your connection.</Text> : <Dots size={6} />}
        </View>
      ) : error ? (
        <View style={[styles.notice, { top: insets.top + 116 }]} pointerEvents="none">
          <Text style={styles.noticeText}>Showing the last update. {error}</Text>
        </View>
      ) : vehicles.features.length === 0 ? (
        <View style={[styles.notice, { top: insets.top + 116 }]} pointerEvents="none">
          <Text style={styles.noticeText}>{devices.length > 0 && filter !== "all" ? "No vehicle has this status right now." : "No vehicle has reported a position yet."}</Text>
        </View>
      ) : null}

      {/* Round buttons on the right, just above the card (or the bottom edge when no vehicle is picked). */}
      <View style={[styles.fabs, { bottom: selected ? cardHeight + (steps.length > 1 ? 60 : space.md) : space.md }]} pointerEvents="box-none">
        {styleMenu ? (
          <SlideUp style={styles.styleMenu}>
            {MAP_STYLES.map((m) => (
              <Pressable key={m.id} onPress={() => pickStyle(m.id)} style={styles.styleItem} accessibilityRole="button" accessibilityState={{ selected: m.id === style }}>
                <Text style={[styles.styleText, m.id === style && styles.styleTextOn]}>{m.label}</Text>
                {m.id === style ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </SlideUp>
        ) : null}
        <PressableScale onPress={fitAll} scaleTo={0.9} style={styles.fab} accessibilityRole="button" accessibilityLabel="Show all vehicles">
          <Ionicons name="scan-outline" size={size.icon} color={colors.foreground} />
        </PressableScale>
        <PressableScale onPress={() => setStyleMenu((open) => !open)} scaleTo={0.9} style={styles.fab} accessibilityRole="button" accessibilityLabel="Change the map style">
          <Ionicons name="layers-outline" size={size.icon} color={colors.foreground} />
        </PressableScale>
      </View>

      {selected && selectedState ? (
        <>
          {/* Prev / Next float just above the sheet, so switching vehicles needs one thumb. */}
          {steps.length > 1 ? (
            <View style={[styles.stepRow, { bottom: cardHeight + space.sm }]} pointerEvents="box-none">
              <PressableScale onPress={() => step(-1)} scaleTo={0.94} style={styles.stepPill} accessibilityRole="button" accessibilityLabel="Previous vehicle">
                <Ionicons name="chevron-back" size={16} color={colors.primaryForeground} />
                <Text style={styles.stepText}>Prev</Text>
              </PressableScale>
              <View style={styles.stepCount}>
                <Text style={styles.stepCountText}>{stepIndex >= 0 ? `${stepIndex + 1} of ${steps.length}` : `${steps.length} vehicles`}</Text>
              </View>
              <PressableScale onPress={() => step(1)} scaleTo={0.94} style={styles.stepPill} accessibilityRole="button" accessibilityLabel="Next vehicle">
                <Text style={styles.stepText}>Next</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primaryForeground} />
              </PressableScale>
            </View>
          ) : null}
          <SlideUp style={styles.card}>
            <View onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)} style={styles.cardBody}>
              <View style={styles.grab} />
              {/* Keyed by vehicle, so stepping to another one fades the new one in. */}
              <FadeIn key={selected.deviceId} style={styles.cardInner}>
                <View style={styles.cardHead}>
                  <VehiclePicture type={selected.vehicle?.type} width={80} height={60} />
                  <View style={styles.cardTitle}>
                    <Text style={styles.cardName} numberOfLines={1}>{displayName(selected)}</Text>
                    <View style={styles.cardNameLine}>
                      <StatusPill state={selectedState} compact />
                      <Text style={styles.cardSub} numberOfLines={1}>{freshnessLine(selected, now)}</Text>
                    </View>
                  </View>
                  <PressableScale onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: selected.deviceId } })} hitSlop={6} style={styles.more} accessibilityRole="button" accessibilityLabel="Vehicle details">
                    <Ionicons name="ellipsis-horizontal" size={22} color={colors.foreground} />
                  </PressableScale>
                </View>
                <SpeedBar speed={speedText[0]} unit={speedText[1]} title={headline.title} detail={headline.detail} headingDeg={loc?.headingDeg ?? null} />
                <AddressCard title={null} coords={coordsText(selected) ?? "No position yet"} label={selectedState === "offline" || selectedState === "parked" ? "Last known position" : undefined} />
                <View style={styles.tiles}>
                  <FactTile icon="key-outline" label="Ignition" value={facts!.ignition} color={facts!.ignition === "Off" ? STATE_META.stopped.color : STATE_META.moving.color} soft={facts!.ignition === "Off" ? STATE_META.stopped.soft : STATE_META.moving.soft} />
                  <FactTile icon="pulse-outline" label="Motion" value={facts!.motion} color={colors.primary} soft={colors.primarySoft} valueColor={facts!.motion === "Moving" ? STATE_META.moving.color : colors.foreground} />
                  <FactTile icon="locate-outline" label="GPS" value={facts!.gps.value} color={facts!.gps.fresh ? "#7c3aed" : STATE_META.idle.color} soft={facts!.gps.fresh ? "#f3edff" : STATE_META.idle.soft} />
                  <FactTile icon="wifi-outline" label="Tracker" value={facts!.tracker.value} color={facts!.tracker.online ? STATE_META.idle.color : STATE_META.offline.color} soft={facts!.tracker.online ? STATE_META.idle.soft : STATE_META.offline.soft} valueColor={facts!.tracker.online ? STATE_META.moving.color : STATE_META.offline.color} />
                </View>
              </FadeIn>
              <View style={styles.cardActions}>
                <ActionButton icon={following ? "navigate" : "navigate-outline"} label={following ? "Following" : "Follow"} primary onPress={toggleFollow} selected={following} />
                <ActionButton icon="git-commit-outline" label="Trips" onPress={() => router.push({ pathname: "/trips/[id]", params: { id: selected.deviceId } })} />
                <ActionButton icon="map-outline" label="Navigate" onPress={openInMaps} />
                <ActionButton icon="information-circle-outline" label="Details" onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: selected.deviceId } })} />
              </View>
            </View>
          </SlideUp>
        </>
      ) : null}

      {intro ? <GlobeIntro onDive={dive} onDone={endIntro} /> : null}

      <FleetSheet
        visible={listOpen}
        devices={devices}
        filter={filter}
        onFilter={setFilter}
        fmtSpeed={units.fmtSpeed}
        now={now}
        onClose={() => setListOpen(false)}
        onPick={(id) => {
          setListOpen(false);
          focus(id);
        }}
      />
    </View>
  );
}

/** One of the big buttons under the vehicle sheet: an icon over a word. */
function ActionButton({ icon, label, onPress, primary = false, selected = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; selected?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, primary && styles.actionPrimary, selected && styles.actionOn]} accessibilityRole="button" accessibilityState={primary ? { selected } : undefined}>
      <Ionicons name={icon} size={19} color={primary ? colors.primaryForeground : colors.primary} />
      <Text style={[styles.actionText, primary && { color: colors.primaryForeground }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  map: { flex: 1 },
  flex: { flex: 1 },
  dim: { opacity: 0.35 },
  top: { position: "absolute", left: 0, right: 0, gap: space.sm },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: space.md, paddingHorizontal: 14, height: size.control, borderRadius: radius.xl, backgroundColor: colors.background, ...elevation.md },
  searchText: { flex: 1, fontSize: font.body, lineHeight: 20, color: colors.mutedForeground },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.md, borderLeftWidth: 1, borderLeftColor: colors.border },
  liveText: { fontSize: font.caption, lineHeight: 16, fontWeight: "600" },
  chips: { paddingHorizontal: space.md, gap: 6, paddingBottom: 6 },
  fabs: { position: "absolute", right: space.md, gap: space.sm, alignItems: "flex-end" },
  fab: { width: size.controlSm, height: size.controlSm, borderRadius: size.controlSm / 2, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", ...elevation.md },
  styleMenu: { minWidth: 150, backgroundColor: colors.background, borderRadius: radius.lg, paddingVertical: 4, ...elevation.lg },
  styleItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.md, minHeight: size.controlSm },
  styleText: { fontSize: font.body, color: colors.foreground },
  styleTextOn: { color: colors.primary, fontWeight: "600" },
  notice: { position: "absolute", alignSelf: "center", maxWidth: "72%", backgroundColor: colors.background, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, ...elevation.md },
  noticeText: { fontSize: font.small, lineHeight: 18, color: colors.foreground, textAlign: "center" },
  card: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...elevation.lg },
  cardBody: { paddingHorizontal: 14, paddingTop: space.sm, paddingBottom: space.md, gap: 10 },
  cardInner: { gap: 10 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  cardTitle: { flex: 1, minWidth: 0, gap: 4 },
  cardNameLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardName: { fontSize: 20, lineHeight: 25, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground },
  cardSub: { ...type.caption, flexShrink: 1, fontVariant: ["tabular-nums"] },
  more: { width: size.controlSm, height: size.controlSm, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: 6 },
  stepRow: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepPill: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: space.lg, borderRadius: 20, backgroundColor: colors.primary, ...elevation.md },
  stepText: { fontSize: 14, fontWeight: "700", color: colors.primaryForeground },
  stepCount: { height: 34, paddingHorizontal: space.md, borderRadius: 17, backgroundColor: colors.background, justifyContent: "center", ...elevation.md },
  stepCountText: { fontSize: 13, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  cardActions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 56, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  actionText: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.foreground }
});
