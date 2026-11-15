import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { api } from "@/api";
import { Card } from "@/components/kit";
import { PressableScale } from "@/components/motion";
import { useFleet } from "@/fleet/FleetProvider";
import { STATE_META } from "@/fleet/model";
import { colors, space, themed, type } from "@/theme";
import { dayRange, durationText, todayKey, type TripReport } from "./model";

/**
 * Vehicle details → Today: the day's trips from the trips report (nothing made up), newest first,
 * each opening its replay, and a link to the full history.
 */
export function TodayCard({ deviceId, name }: { deviceId: string; name: string }) {
  const router = useRouter();
  const { units, timeZone, timeFormat } = useFleet();
  const fmt = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);
  const [report, setReport] = useState<TripReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const { from, to } = dayRange(todayKey(timeZone), timeZone);
    api
      .get<TripReport>("reports/trips", { deviceId, from, to, tz: timeZone })
      .then((r) => live && setReport(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deviceId, timeZone]);

  const trips = report ? [...report.trips].reverse().slice(0, 4) : [];
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={type.label}>TODAY</Text>
        {report && report.totals.trips > 0 ? (
          <Text style={styles.total}>{`${units.fmtDist(report.totals.distanceKm)} · ${durationText(report.totals.drivingMin)} driving`}</Text>
        ) : null}
      </View>
      {!report && !failed ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : null}
      {failed ? <Text style={styles.quiet}>Trips could not load. Pull to refresh later.</Text> : null}
      {report && trips.length === 0 ? <Text style={styles.quiet}>No trips yet today.</Text> : null}
      {trips.map((t, i) => (
        <PressableScale
          key={t.startAt}
          onPress={() => router.push({ pathname: "/trip", params: { id: deviceId, from: t.startAt, to: t.endAt, name } })}
          scaleTo={0.985}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={`Trip at ${fmt.time(Date.parse(t.startAt))}, ${units.fmtDist(t.distanceKm)}. Replay.`}
        >
          <Text style={styles.time}>{fmt.time(Date.parse(t.startAt))}</Text>
          <View style={styles.rail}>
            <View style={[styles.dot, { borderColor: STATE_META.moving.color }]} />
            {i < trips.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>{`Drove ${units.fmtDist(t.distanceKm)} · ${durationText(t.drivingMin)}`}</Text>
            <Text style={type.small} numberOfLines={1}>{`${fmt.time(Date.parse(t.startAt))} – ${fmt.time(Date.parse(t.endAt))} · top ${units.fmtSpeed(t.maxSpeedKph)}`}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </PressableScale>
      ))}
      <PressableScale onPress={() => router.push({ pathname: "/trips/[id]", params: { id: deviceId } })} scaleTo={0.985} style={styles.more} accessibilityRole="button">
        <Text style={styles.moreText}>All trips</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
      </PressableScale>
    </Card>
  );
}

const styles = themed(() => ({
  card: { gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  total: { ...type.small, fontVariant: ["tabular-nums"] },
  pad: { padding: space.md },
  quiet: { ...type.body, color: colors.mutedForeground, paddingVertical: space.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, minHeight: 52 },
  time: { width: 54, textAlign: "right", ...type.caption, paddingTop: 2, fontVariant: ["tabular-nums"] },
  rail: { alignItems: "center", alignSelf: "stretch", width: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, backgroundColor: colors.background, marginTop: 4 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  body: { flex: 1, minWidth: 0, paddingBottom: space.md },
  title: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, marginTop: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  moreText: { fontSize: 14, fontWeight: "700", color: colors.primary }
}));
