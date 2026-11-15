import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { colors, elevation } from "@/theme";

export type SheetSnap = "peek" | "half" | "full";

/**
 * The sheet over the live map, like Life360's: it rests low (peek) so the map stays big, and is
 * dragged by its handle to half or nearly full height. Lifting it never hides the map entirely.
 * `heights` are the visible heights for each stop; `snap` and `onSnap` make it controlled.
 */
export function MapSheet({ heights, snap, onSnap, onHeight, header, children }: { heights: Record<SheetSnap, number>; snap: SheetSnap; onSnap: (s: SheetSnap) => void; onHeight?: (h: number) => void; header: ReactNode; children: ReactNode }) {
  const full = heights.full;
  // translateY 0 = fully open; full - h = showing h.
  const y = useRef(new Animated.Value(full - heights[snap])).current;
  const start = useRef(0);
  const current = useRef(full - heights[snap]);

  useEffect(() => {
    const to = full - heights[snap];
    current.current = to;
    Animated.spring(y, { toValue: to, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
    onHeight?.(heights[snap]);
  }, [snap, full, heights, y, onHeight]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          y.stopAnimation((v) => (start.current = v));
        },
        onPanResponderMove: (_, g) => y.setValue(Math.min(full - heights.peek + 40, Math.max(0, start.current + g.dy))),
        onPanResponderRelease: (_, g) => {
          const shown = full - (start.current + g.dy);
          // A flick goes one stop in its direction; a slow drag settles on the nearest stop.
          const order: SheetSnap[] = ["peek", "half", "full"];
          let next: SheetSnap;
          if (Math.abs(g.vy) > 0.6) {
            const i = order.indexOf(snap);
            next = order[Math.max(0, Math.min(2, i + (g.vy < 0 ? 1 : -1)))]!;
          } else {
            next = order.reduce((best, s) => (Math.abs(heights[s] - shown) < Math.abs(heights[best] - shown) ? s : best), "peek" as SheetSnap);
          }
          if (next === snap) Animated.spring(y, { toValue: full - heights[snap], useNativeDriver: true, speed: 18, bounciness: 4 }).start();
          else onSnap(next);
        }
      }),
    [full, heights, onSnap, snap, y]
  );

  return (
    <Animated.View style={[styles.sheet, { height: full, transform: [{ translateY: y }] }]}>
      <View {...pan.panHandlers} style={styles.drag}>
        <View style={styles.grab} />
        {header}
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

export function measure(set: (h: number) => void) {
  return (e: LayoutChangeEvent) => set(e.nativeEvent.layout.height);
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...elevation.lg },
  drag: { paddingTop: 8 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 8 },
  body: { flex: 1, minHeight: 0 }
});
