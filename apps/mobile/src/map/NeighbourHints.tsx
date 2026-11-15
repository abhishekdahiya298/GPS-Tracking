import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Image, PanResponder, Text, View } from "react-native";
import { PressableScale } from "@/components/motion";
import { displayName, fleetState, STATE_META, type FleetDevice } from "@/fleet/model";
import { haptic } from "@/haptics";
import { colors, elevation, themed } from "@/theme";
import { iconName } from "./model";
import { MAP_ICONS } from "./sprites";

const SIZE = 42;
const GAP = SIZE + 22;
const MAX = 6;

/**
 * Life360-style neighbours: every vehicle that is just off the screen shows as a round chip on
 * the left or right edge of the map, on the side and at the height where it really is. The ring
 * is its status colour and the little vehicle points the way it is heading. Tap one to go there.
 */
export function EdgeChips({
  devices,
  bounds,
  area,
  skipId,
  onPick
}: {
  devices: FleetDevice[];
  /** What the map shows now: [west, south, east, north]. */
  bounds: [number, number, number, number] | null;
  /** The visible part of the map: between the search bar and the sheet. */
  area: { top: number; bottom: number; width: number };
  skipId: string | null;
  onPick: (deviceId: string) => void;
}) {
  const chips = useMemo(() => {
    if (!bounds || area.width <= 0 || area.bottom - area.top < GAP * 2) return [];
    const [w, s, e, n] = bounds;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const spanX = Math.max(e - w, 1e-6);
    const spanY = Math.max(n - s, 1e-6);
    const off = devices
      .filter((d) => d.deviceId !== skipId && d.location)
      .map((d) => ({ d, lng: d.location!.longitude, lat: d.location!.latitude }))
      .filter((p) => p.lng < w || p.lng > e || p.lat < s || p.lat > n)
      // Nearest first, measured in screens, so the chips are the vehicles "next door".
      .map((p) => ({ ...p, away: Math.hypot((p.lng - cx) / spanX, (p.lat - cy) / spanY) }))
      .sort((a, b) => a.away - b.away)
      .slice(0, MAX);
    const lay = (side: "left" | "right") => {
      const list = off
        .filter((p) => (side === "left" ? p.lng < cx : p.lng >= cx))
        .map((p) => ({ ...p, y: area.top + Math.min(1, Math.max(0, (n - p.lat) / spanY)) * (area.bottom - area.top - GAP) }))
        .sort((a, b) => a.y - b.y);
      // Keep them from sitting on top of each other.
      for (let i = 1; i < list.length; i++) if (list[i]!.y - list[i - 1]!.y < GAP) list[i]!.y = list[i - 1]!.y + GAP;
      return list.filter((p) => p.y <= area.bottom - GAP).map((p) => ({ ...p, side }));
    };
    return [...lay("left"), ...lay("right")];
  }, [devices, bounds, area.top, area.bottom, area.width, skipId]);

  return (
    <>
      {chips.map(({ d, y, side }) => {
        const state = fleetState(d);
        const meta = STATE_META[state === "never_seen" ? "offline" : state];
        const icon = MAP_ICONS[iconName(d.vehicle?.type, state, { style: "top", color: "status" })];
        const name = displayName(d);
        return (
          <View key={d.deviceId} style={[styles.slot, { top: y }, side === "left" ? { left: 6 } : { right: 6 }]}>
            <PressableScale
              onPress={() => {
                haptic.tap();
                onPick(d.deviceId);
              }}
              scaleTo={0.9}
              hitSlop={6}
              style={styles.press}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${meta.label}. Show on the map`}
            >
              <View style={[styles.badge, { borderColor: meta.color }]}>
                {icon ? <Image source={icon} style={[styles.icon, { transform: [{ rotate: `${d.location?.headingDeg ?? 0}deg` }] }]} resizeMode="contain" /> : <Ionicons name="car-outline" size={18} color={colors.primary} />}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
            </PressableScale>
          </View>
        );
      })}
    </>
  );
}

/**
 * Wraps the open vehicle's header: swipe it left for the next vehicle, right for the previous one.
 * The header follows the finger, then slides out and the new one comes in from the other side.
 */
export function SwipeToStep({ children, onStep, enabled, keyId }: { children: ReactNode; onStep: (by: -1 | 1) => void; enabled: boolean; keyId: string }) {
  const x = useRef(new Animated.Value(0)).current;
  const from = useRef<0 | -1 | 1>(0);
  useEffect(() => {
    if (from.current === 0) return;
    x.setValue(from.current * 60);
    from.current = 0;
    Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 2 }).start();
  }, [keyId, x]);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => enabled && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => x.setValue(g.dx * 0.9),
        onPanResponderRelease: (_, g) => {
          const by: 0 | -1 | 1 = g.dx < -60 || g.vx < -0.6 ? 1 : g.dx > 60 || g.vx > 0.6 ? -1 : 0;
          if (by === 0) {
            Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
            return;
          }
          haptic.tap();
          Animated.timing(x, { toValue: by === 1 ? -160 : 160, duration: 120, useNativeDriver: true }).start(() => {
            from.current = by === 1 ? 1 : -1;
            onStep(by);
          });
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start()
      }),
    [enabled, onStep, x]
  );
  const opacity = x.interpolate({ inputRange: [-160, 0, 160], outputRange: [0.3, 1, 0.3] });
  return (
    <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], opacity }}>
      {children}
    </Animated.View>
  );
}

const styles = themed(() => ({
  slot: { position: "absolute", alignItems: "center" },
  press: { alignItems: "center", gap: 2 },
  badge: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 3, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", overflow: "hidden", ...elevation.md },
  icon: { width: 17, height: 27 },
  name: { maxWidth: 78, paddingHorizontal: 6, borderRadius: 8, overflow: "hidden", backgroundColor: colors.background, fontSize: 10, lineHeight: 14, fontWeight: "700", color: colors.foreground }
}));
