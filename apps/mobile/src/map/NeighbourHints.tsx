import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Image, PanResponder, StyleSheet, Text, View } from "react-native";
import { PressableScale } from "@/components/motion";
import { displayName, fleetState, STATE_META, type FleetDevice } from "@/fleet/model";
import { haptic } from "@/haptics";
import { colors, elevation } from "@/theme";
import { bearing, iconName, type IconPrefs } from "./model";
import { MAP_ICONS } from "./sprites";

const SIZE = 40;
const EDGE = 10;

/**
 * Life360-style hints while a vehicle is open: the previous vehicle as a small round icon on the
 * left edge and the next one on the right, each with an arrow pointing to where it really is. Tap one to glide there. They fade in again each time the vehicle changes.
 */
export function NeighbourHints({
  from,
  prev,
  next,
  area,
  prefs,
  onStep,
  keyId
}: {
  from: [number, number] | null;
  prev?: FleetDevice;
  next?: FleetDevice;
  /** The visible part of the map: between the search bar and the sheet. */
  area: { top: number; bottom: number; width: number };
  prefs: IconPrefs;
  onStep: (by: -1 | 1) => void;
  keyId: string;
}) {
  const show = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    show.setValue(0);
    Animated.timing(show, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [keyId, show]);
  if (!from || area.width <= 0 || area.bottom - area.top < SIZE * 3) return null;

  // Previous on the left edge, next on the right edge; up or down that edge by where the vehicle
  // really is (north = higher), and the arrow on the ring points straight at it.
  const place = (d: FleetDevice, by: -1 | 1) => {
    const loc = d.location;
    if (!loc) return null;
    const deg = bearing(from, [loc.longitude, loc.latitude]);
    const north = Math.cos((deg * Math.PI) / 180);
    const cy = (area.top + area.bottom) / 2;
    const half = (area.bottom - area.top) / 2 - SIZE - 14;
    const y = cy - north * half - SIZE / 2;
    const x = by === -1 ? EDGE : area.width - EDGE - SIZE;
    return { x, y, deg };
  };

  const chip = (d: FleetDevice | undefined, by: -1 | 1) => {
    if (!d) return null;
    const at = place(d, by);
    if (!at) return null;
    const state = fleetState(d);
    const meta = STATE_META[state === "never_seen" ? "offline" : state];
    const icon = MAP_ICONS[iconName(d.vehicle?.type, state, { style: "circle", color: prefs.color })];
    const name = displayName(d);
    return (
      <Animated.View key={`${by}-${d.deviceId}`} style={[styles.slot, { left: at.x, top: at.y, opacity: show, transform: [{ scale: show.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        <PressableScale
          onPress={() => {
            haptic.tap();
            onStep(by);
          }}
          scaleTo={0.9}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${by === -1 ? "Previous" : "Next"} vehicle: ${name}`}
        >
          {/* The arrow sits on the ring, on the side the vehicle is. */}
          <View style={[styles.ring, { transform: [{ rotate: `${at.deg}deg` }] }]} pointerEvents="none">
            <View style={[styles.arrow, { borderBottomColor: meta.color }]} />
          </View>
          <View style={[styles.badge, { borderColor: meta.color }]}>
            {icon ? <Image source={icon} style={styles.icon} resizeMode="contain" /> : <Ionicons name="car-outline" size={18} color={colors.primary} />}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </PressableScale>
      </Animated.View>
    );
  };
  return (
    <>
      {chip(prev, -1)}
      {chip(next, 1)}
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

const styles = StyleSheet.create({
  slot: { position: "absolute", width: SIZE, alignItems: "center" },
  ring: { position: "absolute", left: -6, top: -6, width: SIZE + 12, height: SIZE + 12, alignItems: "center" },
  arrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 8, borderLeftColor: "transparent", borderRightColor: "transparent" },
  badge: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2.5, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", ...elevation.md },
  icon: { width: 30, height: 32 },
  name: { position: "absolute", top: SIZE + 3, width: 84, left: (SIZE - 84) / 2, textAlign: "center", fontSize: 11, lineHeight: 14, fontWeight: "700", color: colors.foreground, textShadowColor: colors.background, textShadowRadius: 3 }
});
