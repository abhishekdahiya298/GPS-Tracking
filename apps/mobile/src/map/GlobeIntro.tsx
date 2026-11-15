import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- React Native loads images with require() */
const GLOBE = require("../../assets/globe.png");

/** Shortest time the Earth stays up, so the opening never flickers past. */
const MIN_SHOW_MS = 1600;
/** If the fleet still isn't known after this, open the map anyway. */
const GIVE_UP_MS = 9000;

/** A fixed scatter of stars (same every time, so nothing jumps between renders). */
function stars(width: number, height: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 70 }, () => ({ x: rnd() * width, y: rnd() * height, r: rnd() < 0.85 ? 1 : 1.8, o: 0.35 + rnd() * 0.6 }));
}

/**
 * The opening of the map. The Earth appears in space at once and slowly breathes while the map
 * and the fleet load underneath ("Finding your fleet…"). When the fleet is known (`ready`), the
 * globe rushes toward the viewer and fades while the map flies from the whole world down to the
 * vehicles, so the two read as one dive. `onDive` starts the map's flight; `onDone` removes this.
 */
export function GlobeIntro({ ready, count, onDive, onDone }: { ready: boolean; count: number; onDive: () => void; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const sky = useMemo(() => stars(width, height), [width, height]);
  const appear = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const dive = useRef(new Animated.Value(0)).current;
  const shownAt = useRef(Date.now());
  const [reduce, setReduce] = useState<boolean | null>(null);
  const diving = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then(setReduce);
  }, []);

  useEffect(() => {
    if (reduce !== false) return;
    Animated.timing(appear, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, appear, breathe]);

  useEffect(() => {
    if (reduce === null) return;
    const go = () => {
      if (diving.current) return;
      diving.current = true;
      onDive();
      if (reduce) return onDone();
      Animated.timing(dive, { toValue: 1, duration: 1100, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onDone());
    };
    if (!ready) {
      const t = setTimeout(go, GIVE_UP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(go, Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [ready, reduce, dive, onDive, onDone]);

  const size = Math.min(width * 0.68, 300);
  const scale = Animated.multiply(
    Animated.multiply(appear.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }), breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] })),
    dive.interpolate({ inputRange: [0, 1], outputRange: [1, 8] })
  );
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.space, { opacity: dive.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.85, 0] }) }]} accessibilityLabel="Finding your fleet" accessibilityRole="progressbar">
      {sky.map((st, i) => (
        <View key={i} style={[styles.star, { left: st.x, top: st.y, width: st.r * 2, height: st.r * 2, borderRadius: st.r, opacity: st.o }]} />
      ))}
      <Animated.View style={[styles.glow, { width: size * 1.25, height: size * 1.25, borderRadius: size, opacity: appear.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) }]} />
      <Animated.View style={{ opacity: appear, transform: [{ scale }] }}>
        <Image source={GLOBE} style={{ width: size, height: size }} />
      </Animated.View>
      <Animated.View style={[styles.caption, { opacity: Animated.multiply(appear, dive.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: "clamp" })) }]}>
        <Text style={styles.title}>{ready ? (count === 1 ? "1 vehicle found" : `${count} vehicles found`) : "Finding your fleet…"}</Text>
        <Text style={styles.sub}>Live from every tracker</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  space: { backgroundColor: "#040a18", alignItems: "center", justifyContent: "center" },
  star: { position: "absolute", backgroundColor: "#ffffff" },
  glow: { position: "absolute", backgroundColor: "#1d4ed8" },
  caption: { position: "absolute", bottom: "18%", alignItems: "center", gap: 4 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: "#ffffff" },
  sub: { fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.7)" }
});
