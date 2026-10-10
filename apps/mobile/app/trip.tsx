import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useLocalSearchParams } from "expo-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { ApiError, api } from "@/api";
import { Button } from "@/components/ui";
import { Placeholder } from "@/components/Placeholder";
import { useFleet } from "@/fleet/FleetProvider";
import { colors, font, radius, space } from "@/theme";
import { SPEEDS, advance, buildTrack, positionAt, progressOf, timeAtProgress, type HistoryPage, type HistoryPoint, type Track } from "@/trips/model";

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const TripMap = inExpoGo ? null : lazy(() => import("@/trips/TripMap"));
/** A long haul can hold many thousands of points; this is the same ceiling as the website. */
const MAX_POINTS = 20_000;
const TICK_MS = 100;

type Load = { state: "loading" } | { state: "ready"; track: Track } | { state: "empty" } | { state: "failed"; message: string };

export default function TripScreen() {
  const { id, from, to, name } = useLocalSearchParams<{ id: string; from: string; to: string; name?: string }>();
  const { units, timeZone, timeFormat } = useFleet();
  const fmt = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[0]);
  const barWidth = useRef(1);

  const fetchTrack = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      // The history window ends just after the trip's last point, which sits exactly on `to`.
      const end = new Date(Date.parse(to) + 1000).toISOString();
      const points: HistoryPoint[] = [];
      let cursor: string | null = null;
      do {
        const page: HistoryPage = await api.get<HistoryPage>("locations/history", { deviceId: id, from, to: end, limit: 5000, cursor });
        points.push(...page.points);
        cursor = page.nextCursor;
      } while (cursor && points.length < MAX_POINTS);
      const track = buildTrack(points);
      if (!track) return setLoad({ state: "empty" });
      setT(track.startT);
      setLoad({ state: "ready", track });
    } catch (e) {
      if (e instanceof ApiError && e.kind === "unauthorized") return;
      setLoad({ state: "failed", message: e instanceof ApiError ? (e.kind === "forbidden" ? "Your account can't view trip history." : e.message) : "Something went wrong." });
    }
  }, [id, from, to]);

  useEffect(() => {
    void fetchTrack();
  }, [fetchTrack]);

  const track = load.state === "ready" ? load.track : null;

  // The playback clock: advance by real elapsed time, so a slow phone skips frames instead of slowing down.
  useEffect(() => {
    if (!playing || !track) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      setT((current) => {
        const next = advance(track, current, elapsed, speed);
        if (next >= track.endT) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, track, speed]);

  function togglePlay() {
    if (!track) return;
    if (!playing && t >= track.endT) setT(track.startT);
    setPlaying(!playing);
  }

  function seek(event: GestureResponderEvent) {
    if (track) setT(timeAtProgress(track, event.nativeEvent.locationX / barWidth.current));
  }

  const title = name ? `${name} trip` : "Trip";
  if (load.state !== "ready" || !track) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title }} />
        {load.state === "loading" ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.muted}>Loading the route</Text>
          </>
        ) : (
          <>
            <Ionicons name={load.state === "empty" ? "trail-sign-outline" : "cloud-offline-outline"} size={36} color={colors.offline} />
            <Text style={styles.emptyTitle}>{load.state === "empty" ? "No route recorded" : "Can't load the route"}</Text>
            <Text style={styles.muted}>{load.state === "failed" ? load.message : "This trip has too few positions to draw."}</Text>
            {load.state === "failed" ? (
              <View style={styles.retry}>
                <Button title="Try again" onPress={() => void fetchTrack()} />
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  }

  const head = positionAt(track, t);
  const progress = progressOf(track, t);

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title }} />
      <View style={styles.flex}>
        {TripMap ? (
          <Suspense fallback={<View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>}>
            <TripMap track={track} at={head.at} />
          </Suspense>
        ) : (
          <Placeholder icon="map-outline" title="Route map" note="The map needs the installed RIO GPS app. It can't run inside Expo Go." />
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.readout}>
          <Text style={styles.clock}>{fmt.timeSec(t)}</Text>
          <Text style={styles.speed}>{units.fmtSpeed(head.speedKph)}</Text>
        </View>

        <View
          style={styles.barHit}
          onLayout={(e) => (barWidth.current = Math.max(1, e.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={seek}
          onResponderMove={seek}
          accessibilityRole="adjustable"
          accessibilityLabel="Trip progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        >
          <View style={styles.bar} pointerEvents="none">
            <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={[styles.knob, { left: `${progress * 100}%` }]} pointerEvents="none" />
        </View>
        <View style={styles.ends}>
          <Text style={styles.endText}>{fmt.time(track.startT)}</Text>
          <Text style={styles.endText}>{fmt.time(track.endT)}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable onPress={togglePlay} style={({ pressed }) => [styles.play, pressed && { backgroundColor: colors.primaryDark }]} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
            <Ionicons name={playing ? "pause" : "play"} size={26} color={colors.primaryForeground} />
          </Pressable>
          <View style={styles.speeds}>
            {SPEEDS.map((s) => (
              <Pressable key={s} onPress={() => setSpeed(s)} style={[styles.speedChip, speed === s && styles.speedChipOn]} accessibilityRole="button" accessibilityState={{ selected: speed === s }} accessibilityLabel={`Speed ${s} times`}>
                <Text style={[styles.speedText, speed === s && styles.speedTextOn]}>{s}x</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm, backgroundColor: colors.canvas },
  retry: { marginTop: space.md, alignSelf: "stretch" },
  emptyTitle: { fontSize: font.title, fontWeight: "600", color: colors.foreground, marginTop: space.sm },
  muted: { fontSize: font.body, color: colors.mutedForeground, textAlign: "center", lineHeight: 21 },
  panel: { backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  readout: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  clock: { fontSize: font.title, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  speed: { fontSize: font.body, fontWeight: "600", color: colors.primary, fontVariant: ["tabular-nums"] },
  barHit: { height: 44, justifyContent: "center" },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.primary },
  knob: { position: "absolute", width: 20, height: 20, borderRadius: 10, marginLeft: -10, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.background, top: 12, shadowColor: "#101828", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  ends: { flexDirection: "row", justifyContent: "space-between", marginTop: -space.xs },
  endText: { fontSize: 12, color: colors.mutedForeground },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.md },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  speeds: { flexDirection: "row", backgroundColor: colors.muted, borderRadius: radius.md, padding: 3 },
  speedChip: { minWidth: 52, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.md - 2 },
  speedChipOn: { backgroundColor: colors.background },
  speedText: { fontSize: font.small, fontWeight: "500", color: colors.mutedForeground },
  speedTextOn: { color: colors.foreground, fontWeight: "700" }
});
