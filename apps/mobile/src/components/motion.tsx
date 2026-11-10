/**
 * Motion building blocks. All use React Native's own Animated API on the native driver
 * (transform and opacity only), so they stay smooth while JavaScript is busy and need no
 * extra native library.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { haptic } from "../haptics";
import { colors, motion, radius } from "../theme";

/** True when the person asked the phone for less motion. Read once; entrance effects are skipped. */
let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on)).catch(() => undefined);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

/** A pressable that dips slightly under the finger and springs back, with a light tick. */
export function PressableScale({
  children,
  style,
  onPress,
  feedback = "tap",
  scaleTo = 0.97,
  ...rest
}: Omit<PressableProps, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle>; feedback?: "tap" | "press" | "none"; scaleTo?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        to(scaleTo);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback === "tap") haptic.tap();
        else if (feedback === "press") haptic.press();
        onPress?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Fades and slides its children in once, when first shown. `index` staggers items in a list. */
export function FadeInUp({ children, index = 0, distance = 12, style }: { children: ReactNode; index?: number; distance?: number; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.slow,
      delay: Math.min(index, motion.maxStagger) * motion.stagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index]);
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>{children}</Animated.View>
  );
}

/** A grey block that breathes while content loads. */
export function Skeleton({ width, height = 14, round = radius.sm, style }: { width: number | `${number}%`; height?: number; round?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: colors.border, opacity: pulse }, style]} />;
}

/** A status dot. With `live` it sends out a soft ring, like a heartbeat, to show fresh data. */
export function PulseDot({ color, size = 8, live = false }: { color: string; size?: number; live?: boolean }) {
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live || reduceMotion) return;
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => {
      loop.stop();
      ring.setValue(0);
    };
  }, [live, ring]);
  return (
    <Animated.View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {live ? (
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }]
          }}
        />
      ) : null}
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </Animated.View>
  );
}

/** Slides a panel up from the bottom edge when it appears (map cards, sheets). */
export function SlideUp({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
  }, [progress]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>{children}</Animated.View>;
}
