import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet } from "react-native";

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- React Native loads images with require() */
const GLOBE = require("../../assets/globe.png");

/**
 * The opening of the map: the Earth from space, then a dive toward the fleet. The globe grows
 * and fades while the map underneath flies in from a world view, so the two blend into one
 * move. `onDive` starts the map's own flight; `onDone` removes this layer.
 */
export function GlobeIntro({ onDive, onDone }: { onDive: () => void; onDone: () => void }) {
  const appear = useRef(new Animated.Value(0)).current;
  const dive = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          onDive();
          onDone();
          return;
        }
        Animated.sequence([
          Animated.timing(appear, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.delay(260)
        ]).start(() => {
          onDive();
          Animated.timing(dive, { toValue: 1, duration: 900, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onDone());
        });
      });
    return () => {
      cancelled = true;
    };
  }, [appear, dive, onDive, onDone]);

  const scale = Animated.multiply(appear.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), dive.interpolate({ inputRange: [0, 1], outputRange: [1, 7] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.space, { opacity: dive.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.85, 0] }) }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ opacity: appear, transform: [{ scale }] }}>
        <Image source={GLOBE} style={styles.globe} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  space: { backgroundColor: "#050b1a", alignItems: "center", justifyContent: "center" },
  globe: { width: 240, height: 240 }
});
