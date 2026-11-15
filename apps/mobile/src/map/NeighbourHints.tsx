import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Image, PanResponder, StyleSheet, Text } from "react-native";
import { PressableScale } from "@/components/motion";
import { displayName, fleetState, type FleetDevice } from "@/fleet/model";
import { haptic } from "@/haptics";
import { colors, elevation, font, radius } from "@/theme";
import { iconName, type IconPrefs } from "./model";
import { MAP_ICONS } from "./sprites";

/**
 * Life360-style hints at the left and right edges of the map while a vehicle is open:
 * the previous and next vehicle, tap to go there. They slide in each time the vehicle changes.
 */
export function NeighbourHints({ prev, next, top, prefs, onStep, keyId }: { prev?: FleetDevice; next?: FleetDevice; top: number; prefs: IconPrefs; onStep: (by: -1 | 1) => void; keyId: string }) {
  const show = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    show.setValue(0);
    Animated.spring(show, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [keyId, show]);
  if (!prev && !next) return null;
  const chip = (d: FleetDevice, side: "left" | "right") => {
    const icon = MAP_ICONS[iconName(d.vehicle?.type, fleetState(d), prefs.style === "top" ? { style: "circle", color: prefs.color } : prefs)];
    const shift = show.interpolate({ inputRange: [0, 1], outputRange: [side === "left" ? -60 : 60, 0] });
    return (
      <Animated.View style={[styles.slot, side === "left" ? styles.left : styles.right, { top, opacity: show, transform: [{ translateX: shift }] }]}>
        <PressableScale
          onPress={() => {
            haptic.tap();
            onStep(side === "left" ? -1 : 1);
          }}
          scaleTo={0.94}
          style={[styles.chip, side === "left" ? styles.chipLeft : styles.chipRight]}
          accessibilityRole="button"
          accessibilityLabel={`${side === "left" ? "Previous" : "Next"} vehicle: ${displayName(d)}`}
        >
          {side === "left" ? <Ionicons name="chevron-back" size={16} color={colors.primary} /> : null}
          {icon ? <Image source={icon} style={styles.icon} resizeMode="contain" /> : null}
          <Text style={styles.name} numberOfLines={1}>{displayName(d)}</Text>
          {side === "right" ? <Ionicons name="chevron-forward" size={16} color={colors.primary} /> : null}
        </PressableScale>
      </Animated.View>
    );
  };
  return (
    <>
      {prev ? chip(prev, "left") : null}
      {next ? chip(next, "right") : null}
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
    // A new vehicle: come in from the side it was swiped towards.
    if (from.current === 0) return;
    x.setValue(from.current * 80);
    from.current = 0;
    Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
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
          Animated.timing(x, { toValue: by === 1 ? -220 : 220, duration: 140, useNativeDriver: true }).start(() => {
            from.current = by === 1 ? 1 : -1;
            onStep(by);
          });
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start()
      }),
    [enabled, onStep, x]
  );
  const opacity = x.interpolate({ inputRange: [-220, 0, 220], outputRange: [0.2, 1, 0.2] });
  return (
    <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], opacity }}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute" },
  left: { left: 0 },
  right: { right: 0 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, maxWidth: 150, paddingHorizontal: 8, backgroundColor: colors.background, ...elevation.md },
  chipLeft: { borderTopRightRadius: radius.xl * 2, borderBottomRightRadius: radius.xl * 2, paddingLeft: 4 },
  chipRight: { borderTopLeftRadius: radius.xl * 2, borderBottomLeftRadius: radius.xl * 2, paddingRight: 4 },
  icon: { width: 24, height: 26 },
  name: { flexShrink: 1, fontSize: font.caption, lineHeight: 16, fontWeight: "700", color: colors.foreground }
});
