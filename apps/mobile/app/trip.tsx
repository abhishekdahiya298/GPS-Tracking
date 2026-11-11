import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useLocalSearchParams } from "expo-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { ApiError, api } from "@/api";
import { EmptyState, Loading, Segmented } from "@/components/kit";
import { PressableScale, SlideUp } from "@/components/motion";
import { Button } from "@/components/ui";
import { useBottomInset } from "@/layout";
import { Placeholder } from "@/components/Placeholder";
import { useFleet } from "@/fleet/FleetProvider";
import { colors, elevation, font, ink, size, space, type } from "@/theme";
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
  const bottom = useBottomInset();

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
          <Loading text="Loading the route" />
        ) : load.state === "empty" ? (
          <EmptyState icon="trail-sign-outline" title="No route recorded" note="This trip has too few positions to draw." />
        ) : (
          <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load the route" note={load.state === "failed" ? load.message : undefined}>
            <Button title="Try again" icon="refresh" onPress={() => void fetchTrack()} />
          </EmptyState>
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
          <Suspense fallback={<Loading text="Opening the map" />}>
            <TripMap track={track} at={head.at} />
          </Suspense>
        ) : (
          <Placeholder icon="map-outline" title="Route map" note="The map needs the installed RIO GPS app. It can't run inside Expo Go." />
        )}
      </View>

      <SlideUp style={[styles.panel, { paddingBottom: Math.max(space.xl, bottom + space.md) }]}>
        <View style={styles.grabber} />
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
          <PressableScale onPress={togglePlay} feedback="press" scaleTo={0.92} style={styles.play} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
            <Ionicons name={playing ? "pause" : "play"} size={24} color={colors.primaryForeground} />
          </PressableScale>
          <View style={styles.speeds}>
            <Segmented label="Playback speed" value={speed} onChange={setSpeed} options={SPEEDS.map((v) => ({ value: v, label: `${v}x` }))} />
          </View>
        </View>
      </SlideUp>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.canvas },
  panel: { backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: space.xl, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -16, ...elevation.lg },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  readout: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  clock: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground, fontVariant: ["tabular-nums"] },
  speed: { fontSize: font.title, lineHeight: 22, fontWeight: "700", color: ink(colors.primary), fontVariant: ["tabular-nums"] },
  barHit: { height: size.controlSm, justifyContent: "center" },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.primary },
  knob: { position: "absolute", width: 20, height: 20, borderRadius: 10, marginLeft: -10, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.background, top: 12, ...elevation.sm },
  ends: { flexDirection: "row", justifyContent: "space-between", marginTop: -space.xs },
  endText: { ...type.caption, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: space.md },
  play: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", ...elevation.md },
  speeds: { flex: 1 }
});
