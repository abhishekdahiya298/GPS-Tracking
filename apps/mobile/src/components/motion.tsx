/**
 * Motion building blocks. All use React Native's own Animated API on the native driver
 * (transform and opacity only), so they stay smooth while JavaScript is busy and need no
 * extra native library.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
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
  outerStyle,
  onPress,
  feedback = "tap",
  scaleTo = 0.97,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  /** The look of the pressable: it is the part that dips. */
  style?: StyleProp<ViewStyle>;
  /** How the pressable sits in its parent (flex, width). Needed when it must grow or share a row. */
  outerStyle?: StyleProp<ViewStyle>;
  feedback?: "tap" | "press" | "none";
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      {...rest}
      style={outerStyle}
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

/** Fades its children in, without moving them. For content that swaps in place (the map card). */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress]);
  return <Animated.View style={[style, { opacity: progress }]}>{children}</Animated.View>;
}

/** Pops in from slightly small, with a little bounce. For badges and "done" marks. */
export function PopIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  }, [progress]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>{children}</Animated.View>;
}

/**
 * A thin bar with a light that runs across it while something is loading or refreshing.
 * It takes no room when idle, so the screen does not jump when work starts or ends.
 */
export function LoadingBar({ active, style }: { active: boolean; style?: StyleProp<ViewStyle> }) {
  const [width, setWidth] = useState(0);
  const run = useRef(new Animated.Value(0)).current;
  const show = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(show, { toValue: active ? 1 : 0, duration: motion.base, useNativeDriver: true }).start();
    if (!active) return;
    const loop = Animated.loop(Animated.timing(run, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    loop.start();
    return () => {
      loop.stop();
      run.setValue(0);
    };
  }, [active, run, show]);
  const light = Math.max(60, width * 0.35);
  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ height: 3, overflow: "hidden", backgroundColor: colors.primarySoft, opacity: show }, style]}
      accessibilityElementsHidden={!active}
      accessibilityRole={active ? "progressbar" : undefined}
      accessibilityLabel={active ? "Loading" : undefined}
    >
      <Animated.View style={{ width: light, height: 3, borderRadius: 2, backgroundColor: colors.primary, transform: [{ translateX: run.interpolate({ inputRange: [0, 1], outputRange: [-light, width] }) }] }} />
    </Animated.View>
  );
}

/** A whole number that counts to its new value instead of jumping. */
export function CountText({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduceMotion || start === value) return setShown(value);
    const drive = new Animated.Value(0);
    const id = drive.addListener(({ value: p }) => setShown(Math.round(start + (value - start) * p)));
    Animated.timing(drive, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => setShown(value));
    return () => {
      drive.removeListener(id);
      drive.stopAnimation();
    };
  }, [value]);
  return <Text style={style}>{shown}</Text>;
}

/** Three dots that rise in turn: "working on it". Used where a spinner would feel heavy. */
export function Dots({ color = colors.primary, size = 8 }: { color?: string; size?: number }) {
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [beat]);
  return (
    <View style={{ flexDirection: "row", gap: size * 0.75, alignItems: "center", height: size * 2 }} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {[0, 1, 2].map((i) => {
        const a = i * 0.18;
        return (
          <Animated.View
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity: beat.interpolate({ inputRange: [0, a, a + 0.2, a + 0.4, 1], outputRange: [0.35, 0.35, 1, 0.35, 0.35] }),
              transform: [{ translateY: beat.interpolate({ inputRange: [0, a, a + 0.2, a + 0.4, 1], outputRange: [0, 0, -size * 0.6, 0, 0] }) }]
            }}
          />
        );
      })}
    </View>
  );
}
