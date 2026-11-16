import { Ionicons } from "@expo/vector-icons";
import { Camera, GeoJSONSource, Images, Layer, Map, ViewAnnotation, type CameraRef, type GeoJSONSourceRef, type PressEventWithFeatures } from "@maplibre/maplibre-react-native";
import { dateFormatter } from "@rio-gps/core/timezones";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Platform, Pressable, ScrollView, Text, View, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api";
import { AddressCard, Chip, FactRow } from "@/components/kit";
import { Dots, FadeIn, PressableScale, PulseDot, SlideUp } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, coordsText, countByFilter, displayName, fleetState, selectDevices, sheetFacts, sheetHeadline, timeAgo, type FleetFilter } from "@/fleet/model";
import { haptic } from "@/haptics";
import { colors, elevation, font, isDark, radius, size, space, themed, type } from "@/theme";
import { FleetSheet } from "./FleetSheet";
import { MapSheet, type SheetSnap } from "./MapSheet";
import { useStillSince } from "./useStillSince";
import { VehicleRow } from "@/fleet/VehicleRow";
import { durationText } from "@/trips/model";
import { GlobeIntro } from "./GlobeIntro";
import { DEFAULT_CENTER, DEFAULT_ZOOM, WORLD_VIEW, FOCUS_ZOOM, MAP_STYLES, focusZoom, boundsOf, isMapStyleId, positionOf, readTap, styleUrl, zoneFeatures, type MapStyleId, type Zone } from "./model";
import { iconImages } from "./sprites";
import { useMapEngine } from "./mapEngine";
import { NativeLiveMap, type CameraLike, type NativeMapType } from "./NativeLiveMap";
import { useIconPrefs } from "./iconPrefs";
import { useAddress } from "./useAddress";
import { iconPrefix } from "./model";
import { EdgeChips, SwipeToStep } from "./NeighbourHints";
import { ActionRow, VehicleCarousel, factCellsFor, type FactCell } from "./VehicleCard";

/** Movement trails only once the map is close enough for them to read as roads. */
const TRAIL_ZOOM = 11;
/** Zoomed out further than this, vehicles are plain status dots; closer in, the 3D icons. */
const DOT_ZOOM = 4;
import { useGlide } from "./useGlide";

const FIT_PADDING = { top: 190, right: 50, bottom: 240, left: 50 };
const FOLLOW_ZOOM = FOCUS_ZOOM;
const STYLE_KEY = "rio.map-style";
const MAP_TYPE_KEY = "rio.map-type";
/** The opening: how long the whole Earth is held, and how long the descent to the fleet takes. */
const GLOBE_HOLD_MS = 1100;
const DIVE_MS = 2800;
const MAP_TYPES: ReadonlyArray<{ id: NativeMapType; label: string }> = [
  { id: "street", label: "Map" },
  { id: "satellite", label: "Satellite" }
];
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
  const { devices, loading, error, units, connection, timeZone, timeFormat } = useFleet();
  const fmt = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);
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
  const [mapType, setMapType] = useState<NativeMapType>("street");
  // What the map shows now, [west, south, east, north]: tells which vehicles are just off screen.
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const insets = useSafeAreaInsets();
  // The selected-vehicle card's height, so the round buttons can sit just above it.
  const [cardHeight, setCardHeight] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  // Choosing a vehicle (or going back to the fleet) starts the sheet low again, so the map stays big.
  useEffect(() => setSnap("peek"), [selectedId]);
  const fitted = useRef(false);
  // The Earth shows from the first frame (so a slow map never looks blank) and dives once the fleet is known.
  const [intro, setIntro] = useState(() => !introPlayed && !params.device);
  const [diveReady, setDiveReady] = useState(false);
  const diveTo = useRef<ReturnType<typeof boundsOf>>(null);
  // A tap on a vehicle must not also count as a tap on empty map (which closes the card).
  const vehicleTapAt = useRef(0);
  // How far in the map is right now, and the latest fleet, for use inside tap handlers.
  const zoomNow = useRef<number | null>(null);
  const devicesNow = useRef(devices);
  devicesNow.current = devices;

  // The status filter narrows the map exactly as it narrows the list.
  const visible = useMemo(() => (filter === "all" ? devices : selectDevices(devices, filter, "")), [devices, filter]);
  const prefs = useIconPrefs();
  const engine = useMapEngine();
  const images = useMemo(() => iconImages(iconPrefix(prefs)), [prefs]);
  const isPin = prefs.style === "pin";
  const { vehicles, trails } = useGlide(visible, units.fmtSpeed, prefs, selectedId);
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
    SecureStore.getItemAsync(MAP_TYPE_KEY)
      .then((saved) => {
        if (saved === "street" || saved === "satellite") setMapType(saved);
      })
      .catch(() => undefined);
    api
      .get<{ geofences?: Zone[] }>("geofences")
      .then((body) => {
        if (Array.isArray(body.geofences)) setZones(body.geofences);
      })
      .catch(() => undefined);
  }, []);

  function pickMapType(id: NativeMapType) {
    haptic.tap();
    setStyleMenu(false);
    setMapType(id);
    SecureStore.setItemAsync(MAP_TYPE_KEY, id).catch(() => undefined);
  }
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
    // First visit since the app opened: the Earth is already showing; dive to the fleet now.
    introPlayed = true;
    diveTo.current = bounds;
    setDiveReady(true);
  }, [mapReady, devices, params.device]);

  const dive = useCallback(() => {
    if (diveTo.current) camera.current?.fitBounds(diveTo.current, { padding: FIT_PADDING, duration: DIVE_MS, easing: "fly" });
  }, []);
  const endIntro = useCallback(() => {
    introPlayed = true;
    setIntro(false);
  }, []);

  // On iPhone with Apple Maps the opening is the real 3D Earth: the map starts as the globe and
  // flies down to the fleet once it is known, like Life360. Other maps use the drawn GlobeIntro.
  const appleGlobe = engine === "native" && Platform.OS === "ios";
  useEffect(() => {
    if (!appleGlobe || !intro) return;
    if (!diveReady) {
      const giveUp = setTimeout(endIntro, 9000);
      return () => clearTimeout(giveUp);
    }
    // Hold on the whole Earth for a moment, then descend; the street map takes over as it lands.
    const start = setTimeout(dive, GLOBE_HOLD_MS);
    const done = setTimeout(endIntro, GLOBE_HOLD_MS + DIVE_MS + 400);
    return () => {
      clearTimeout(start);
      clearTimeout(done);
    };
  }, [appleGlobe, intro, diveReady, dive, endIntro]);

  // Where the camera centres a chosen vehicle: in the open map above the sheet, not under it.
  const cardH = useRef(0);
  cardH.current = cardHeight;
  const focusPad = useCallback(() => ({ top: 170, left: 40, right: 40, bottom: (cardH.current || 260) + 24 }), []);

  const focus = useCallback(
    (deviceId: string) => {
      const at = positionOf(devices.find((d) => d.deviceId === deviceId));
      setFilter("all");
      setSelectedId(deviceId);
      if (!at) return;
      fitted.current = true;
      setFollowing(true);
      camera.current?.flyTo({ center: at, zoom: FOLLOW_ZOOM, duration: 800, padding: focusPad() });
    },
    [devices, focusPad]
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
    if (following && lng !== undefined && lat !== undefined) camera.current?.easeTo({ center: [lng, lat], duration: 1000, padding: focusPad() });
  }, [following, lng, lat, focusPad]);

  const onVehiclesPress = useCallback(async (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    const tap = readTap(event.nativeEvent.features);
    if (tap.kind !== "none") vehicleTapAt.current = Date.now();
    if (tap.kind === "vehicle") {
      haptic.tap();
      setSelectedId(tap.deviceId);
      setFollowing(false);
      // Bring the vehicle to the middle and come in close enough to see its road.
      const at = positionOf(devicesNow.current.find((d) => d.deviceId === tap.deviceId));
      if (at) camera.current?.flyTo({ center: at, zoom: focusZoom(zoomNow.current), duration: 700, padding: focusPad() });
    } else if (tap.kind === "cluster") {
      // Zoom in just far enough for the group to split.
      const zoom = await source.current?.getClusterExpansionZoom(tap.clusterId).catch(() => null);
      camera.current?.easeTo({ center: tap.at, zoom: (zoom ?? 12) + 0.5, duration: 500 });
    }
  }, [focusPad]);

  /** The arrows on the card: go to the previous or next vehicle and bring it to the middle. */
  function step(by: number) {
    if (steps.length === 0) return;
    const next = steps[(Math.max(stepIndex, 0) + by + steps.length) % steps.length];
    if (!next) return;
    setSelectedId(next.deviceId);
    setFollowing(false);
    const at = positionOf(next);
    if (at) camera.current?.easeTo({ center: at, zoom: focusZoom(zoomNow.current), duration: 550, padding: focusPad() });
  }

  function toggleFollow() {
    if (!selectedAt) return;
    haptic.press();
    if (!following) camera.current?.flyTo({ center: selectedAt, zoom: FOLLOW_ZOOM, duration: 700, padding: focusPad() });
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
  const still = useStillSince(selected?.deviceId ?? null, selectedState);
  const bubble = !selected
    ? null
    : selectedState === "moving"
      ? `${units.fmtSpeed(loc?.speedKph ?? null)}${headline.title.startsWith("Driving ") ? ` · ${headline.title.replace("Driving ", "")}` : ""}`
      : still
        ? `Here for ${durationText((now - still.since) / 60000)}${still.whole ? "+" : ""}`
        : null;
  const address = useAddress(selected?.location?.latitude, selected?.location?.longitude, selectedState === "moving");
  // Short, so it fits next to the status pill: "just now", "Since 7:42 AM", "Seen 6 h ago".
  const placeLine = !selected ? "" : selectedState === "moving" ? timeAgo(selected.location?.recordedAt ?? selected.lastSeenAt, now) : still ? `Since ${fmt.time(still.since)}` : selectedState === "offline" || selectedState === "parked" ? `Seen ${timeAgo(selected.lastSeenAt, now)}` : timeAgo(selected.location?.recordedAt ?? selected.lastSeenAt, now);
  const silent =
    selected && (selectedState === "offline" || selectedState === "parked" || selectedState === "never_seen")
      ? {
          title: selected.lastSeenAt ? `Not reporting for ${durationText((now - Date.parse(selected.lastSeenAt)) / 60000)}` : "No report yet",
          note: selectedState === "parked" ? "Unhooked trailer: reports on its own battery" : "Usually no power or no mobile signal"
        }
      : null;
  const sheetHeights = useMemo(() => {
    const full = Math.max(360, areaHeight - insets.top - 72);
    return selected ? { peek: silent ? 290 : 240, half: Math.min(full, silent ? 470 : 440), full } : { peek: 196, half: Math.min(full, Math.round(areaHeight * 0.5)), full };
  }, [areaHeight, insets.top, selected, silent]);
  const factCells: FactCell[] = selected ? factCellsFor(selected, now, units.fmtSpeed) : [];

  return (
    <View style={styles.wrap} onLayout={(e) => {
        setAreaHeight(e.nativeEvent.layout.height);
      }}>
      {engine === "native" ? (
        <NativeLiveMap
          ref={camera as unknown as React.Ref<CameraLike>}
          vehicles={vehicles}
          trails={trails}
          selectedId={selectedId}
          prefs={prefs}
          topInset={insets.top + 70}
          bottomInset={cardHeight}
          initial={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
          globe={appleGlobe && intro}
          mapType={mapType}
          bubble={bubble}
          onBounds={setBounds}
          onReady={() => setMapReady(true)}
          onZoom={(z) => {
            zoomNow.current = z;
          }}
          onUserMove={() => setFollowing(false)}
          onMapPress={() => {
            setStyleMenu(false);
            if (Date.now() - vehicleTapAt.current > 400) setSelectedId(null);
          }}
          onSelect={(id) => {
            vehicleTapAt.current = Date.now();
            haptic.tap();
            setSelectedId(id);
            setFollowing(false);
            const at = positionOf(devicesNow.current.find((d) => d.deviceId === id));
            if (at) camera.current?.flyTo({ center: at, zoom: focusZoom(zoomNow.current), duration: 700, padding: focusPad() });
          }}
        />
      ) : (
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
          const b = e.nativeEvent.bounds;
          if (Array.isArray(b) && b.length === 4) setBounds([b[0], b[1], b[2], b[3]]);
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
        <Images images={images} />

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
            paint={{ "circle-radius": ["step", ["zoom"], 14, DOT_ZOOM, 30], "circle-color": colors.primary, "circle-opacity": 0.24, "circle-blur": 0.35, "circle-translate": isPin ? ["step", ["zoom"], ["literal", [0, 0]], DOT_ZOOM, ["literal", [0, -32]]] : [0, 0] }}
          />
          {/* Every vehicle is a 3D pin in its status colour at every zoom (groups still merge into bubbles).
              A moving pin's badge points the way it drives. */}
          {/* Zoomed out: a status dot per vehicle, so the map stays readable. */}
          <Layer
            id="vehicle-dots"
            type="circle"
            maxzoom={DOT_ZOOM}
            filter={NOT_CLUSTER}
            paint={{ "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, DOT_ZOOM, 7], "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }}
          />
          {prefs.style === "top" ? (
            <Layer id="vehicle-glow" type="circle" minzoom={DOT_ZOOM} filter={NOT_CLUSTER} paint={{ "circle-radius": ["interpolate", ["linear"], ["zoom"], DOT_ZOOM, 14, 12, 22, 16, 28], "circle-color": ["get", "color"], "circle-opacity": 0.16, "circle-blur": 0.5 }} />
          ) : null}
          <Layer
            id="vehicle-pictures"
            type="symbol"
            minzoom={DOT_ZOOM}
            filter={NOT_CLUSTER}
            layout={{
              "icon-image": ["get", "pin"],
              "icon-size": prefs.style === "top" ? ["interpolate", ["linear"], ["zoom"], DOT_ZOOM, 0.2, 8, 0.25, 12, 0.3, 16, 0.36] : ["interpolate", ["linear"], ["zoom"], DOT_ZOOM, 0.22, 8, 0.27, 12, 0.32, 16, 0.36],
              "icon-anchor": isPin ? "bottom" : "center",
              "icon-rotate": prefs.style === "top" ? ["get", "rot"] : 0,
              "icon-rotation-alignment": prefs.style === "top" ? "map" : "viewport",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "symbol-sort-key": ["case", ["==", ["get", "deviceId"], selectedId ?? ""], 10, ["==", ["get", "state"], "moving"], 3, 1]
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
              "text-offset": isPin ? [0, 0.6] : [0, 2],
              "text-anchor": "top",
              "text-optional": true
            }}
            paint={{ "text-color": labelColor, "text-halo-color": labelHalo, "text-halo-width": 1.6 }}
          />
        </GeoJSONSource>
        {/* The bubble over the chosen vehicle: how long it has stood there, or how fast it goes. */}
        {selected && selectedAt && bubble ? (
          <ViewAnnotation id="selected-bubble" lngLat={selectedAt} anchor="bottom" offset={[0, isPin ? -64 : -34]}>
            <View style={styles.bubble}>
              <Ionicons name={selectedState === "moving" ? "speedometer-outline" : "location"} size={13} color={colors.primary} />
              <Text style={styles.bubbleText}>{bubble}</Text>
            </View>
          </ViewAnnotation>
        ) : null}
      </Map>
      )}

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

      {/* Vehicles just off the screen, as round chips on the left and right edges (like Life360). */}
      {mapReady && !intro && areaHeight > 0 ? (
        <EdgeChips devices={steps} bounds={bounds} area={{ top: insets.top + 122, bottom: areaHeight - cardHeight - 8, width: 1 }} skipId={selectedId} onPick={focus} />
      ) : null}

      {/* Round buttons on the right, just above the card (or the bottom edge when no vehicle is picked). */}
      <View style={[styles.fabs, { bottom: cardHeight + space.md }]} pointerEvents="box-none">
        {styleMenu ? (
          <SlideUp style={styles.styleMenu}>
            {engine === "native"
              ? MAP_TYPES.map((m) => (
                  <Pressable key={m.id} onPress={() => pickMapType(m.id)} style={styles.styleItem} accessibilityRole="button" accessibilityState={{ selected: m.id === mapType }}>
                    <Text style={[styles.styleText, m.id === mapType && styles.styleTextOn]}>{m.label}</Text>
                    {m.id === mapType ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                  </Pressable>
                ))
              : MAP_STYLES.map((m) => (
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
        <PressableScale onPress={() => setStyleMenu((open) => !open)} scaleTo={0.9} style={styles.fab} accessibilityRole="button" accessibilityLabel="Change the map type">
          <Ionicons name="layers-outline" size={size.icon} color={colors.foreground} />
        </PressableScale>
      </View>


      {/* Life360-style sheet: the fleet when nothing is chosen, the vehicle when one is.
          It rests low so the map stays big; drag the handle up for more. */}
      {areaHeight > 0 ? (
        <MapSheet
          heights={sheetHeights}
          snap={snap}
          onSnap={setSnap}
          onHeight={setCardHeight}
          header={
            selected && selectedState ? (
              <FadeIn key={selected.deviceId} style={styles.vehicleHead}>
                <SwipeToStep enabled={steps.length > 1} onStep={step} keyId={selected.deviceId}>
                  <VehicleCarousel
                    device={selected}
                    state={selectedState}
                    sub={placeLine}
                    index={steps.length > 1 && stepIndex >= 0 ? `${stepIndex + 1} of ${steps.length}` : null}
                    prev={steps.length > 1 && stepIndex >= 0 && (steps.length > 2 || stepIndex === 1) ? steps[(stepIndex - 1 + steps.length) % steps.length] : undefined}
                    next={steps.length > 1 && stepIndex >= 0 && (steps.length > 2 || stepIndex === 0) ? steps[(stepIndex + 1) % steps.length] : undefined}
                    facts={factCells}
                    silent={silent}
                    address={address?.label ?? address?.line1 ?? coordsText(selected) ?? "No position yet"}
                    addressLabel={silent ? "Last known" : undefined}
                    onStep={step}
                    onClose={() => setSelectedId(null)}
                  />
                </SwipeToStep>
                <ActionRow
                  following={following}
                  canFollow={!silent && !!selectedAt}
                  onFollow={toggleFollow}
                  onTrips={() => router.push({ pathname: "/trips/[id]", params: { id: selected.deviceId } })}
                  onNavigate={openInMaps}
                  onDetails={() => router.push({ pathname: "/vehicle/[id]", params: { id: selected.deviceId } })}
                />
              </FadeIn>
            ) : (
              <View style={styles.sheetHead}>
                <View style={styles.fleetHead}>
                  <Text style={styles.fleetTitle}>{devices.length === 1 ? "1 vehicle" : `${devices.length} vehicles`}</Text>
                  <Text style={styles.fleetSub}>{counts.moving} moving</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {FILTERS.map((f) => (
                    <Chip key={f.key} label={f.label} count={counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} glyph={f.key} onPress={() => setFilter(f.key)} />
                  ))}
                </ScrollView>
              </View>
            )
          }
        >
          {selected && selectedState ? (
            <ScrollView contentContainerStyle={styles.sheetBody} scrollEnabled={snap === "full"} showsVerticalScrollIndicator={false}>
              <AddressCard title={address?.line1 ?? null} line={address?.line2} coords={coordsText(selected) ?? "No position yet"} label={selectedState === "offline" || selectedState === "parked" ? "Last known position" : undefined} />
              <FactRow facts={facts!} />
              <PressableScale onPress={() => router.push({ pathname: "/trips/[id]", params: { id: selected.deviceId } })} scaleTo={0.985} style={styles.todayCard} accessibilityRole="button">
                <View style={styles.todayIcon}>
                  <Ionicons name="git-commit-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.todayTitle}>Today's trips</Text>
                  <Text style={type.small}>Routes, stops and replay</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </PressableScale>
            </ScrollView>
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(d) => d.deviceId}
              renderItem={({ item }) => <VehicleRow device={item} fmtSpeed={units.fmtSpeed} now={now} onPress={focus} />}
              scrollEnabled={snap !== "peek"}
              contentContainerStyle={styles.fleetList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<Text style={styles.fleetEmpty}>{loading ? "Loading your fleet…" : "No vehicle matches this filter."}</Text>}
            />
          )}
        </MapSheet>
      ) : null}


      {intro && !appleGlobe ? <GlobeIntro ready={diveReady} count={devices.length} onDive={dive} onDone={endIntro} /> : null}

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

const styles = themed(() => ({
  flexFill: { flex: 1, minWidth: 0 },
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
  cardBody: { paddingHorizontal: 14, paddingBottom: space.md, gap: space.sm },
  cardInner: { gap: space.sm },
  grabZone: { alignSelf: "stretch", alignItems: "center", paddingTop: space.sm, paddingBottom: 2 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  vehicleHead: { paddingBottom: space.sm, gap: space.sm },
  sheetHead: { paddingHorizontal: 14, paddingBottom: space.sm, gap: space.sm },
  sheetBody: { paddingHorizontal: 14, paddingBottom: space.xl, gap: space.sm },
  fleetHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 2 },
  fleetTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.foreground },
  fleetSub: { ...type.small, color: colors.success, fontWeight: "600" },
  fleetList: { paddingTop: 2, paddingBottom: space.xl },
  fleetEmpty: { ...type.small, textAlign: "center", padding: space.xl },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  todayCard: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  todayIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  todayTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  bubble: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.background, ...elevation.md },
  bubbleText: { fontSize: 13, lineHeight: 17, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  more: { width: size.controlSm, height: size.controlSm, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: 6 },
  stepRow: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepPill: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: space.lg, borderRadius: 20, backgroundColor: colors.primary, ...elevation.md },
  stepText: { fontSize: 14, fontWeight: "700", color: colors.primaryForeground },
  stepCount: { height: 34, paddingHorizontal: space.md, borderRadius: 17, backgroundColor: colors.background, justifyContent: "center", ...elevation.md },
  stepCountText: { fontSize: 13, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] }
}));
