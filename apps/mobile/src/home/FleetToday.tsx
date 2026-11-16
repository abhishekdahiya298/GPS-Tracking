import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api";
import { Card, VehiclePicture, type IconName } from "@/components/kit";
import { PressableScale, Skeleton } from "@/components/motion";
import { useFleet } from "@/fleet/FleetProvider";
import { STATE_META, fleetState } from "@/fleet/model";
import { dayRange, durationText, todayKey } from "@/trips/model";
import { colors, elevation, ink, isDark, radius, softTint, space, themed, type } from "@/theme";

/** The parts of the mileage and speeding reports this card reads. */
interface MileageReport {
  rows: { distanceKm: number; drivingMin: number; idleMin: number; trips: number }[];
  byVehicle: { deviceId: string; vehicle: string; distanceKm: number }[];
}
interface SpeedingReport {
  totals: { count: number; maxSpeedKph: number };
}
interface Today {
  distanceKm: number;
  drivingMin: number;
  idleMin: number;
  trips: number;
  speeding: number;
  topSpeedKph: number;
  leaders: { deviceId: string; vehicle: string; distanceKm: number }[];
}

/** Gold, silver and bronze for the three that drove furthest. */
const MEDAL = [
  { bg: "#fde68a", fg: "#854d0e" },
  { bg: "#e2e8f0", fg: "#334155" },
  { bg: "#fed7aa", fg: "#9a3412" }
];

/**
 * Overview → "Today across the fleet": distance, driving and idle time and speeding from the
 * server's mileage and speeding reports for today (nothing made up), then the three vehicles
 * that drove furthest with their share of the leader's distance. Quietly hidden if the account
 * can't read history.
 */
export function FleetToday({ onVehicle, onAll }: { onVehicle: (deviceId: string) => void; onAll: () => void }) {
  const { units, timeZone, devices } = useFleet();
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  const byId = useMemo(() => new Map(devices.map((d) => [d.deviceId, d])), [devices]);

  useEffect(() => {
    let live = true;
    const { from, to } = dayRange(todayKey(timeZone), timeZone);
    const q = { deviceId: "all", from, to, tz: timeZone };
    Promise.all([api.get<MileageReport>("reports/activity", { ...q, type: "mileage" }), api.get<SpeedingReport>("reports/activity", { ...q, type: "speeding" })])
      .then(([m, sp]) => {
        if (!live) return;
        const sum = (k: "distanceKm" | "drivingMin" | "idleMin" | "trips") => m.rows.reduce((t, r) => t + (r[k] ?? 0), 0);
        setToday({
          distanceKm: sum("distanceKm"),
          drivingMin: sum("drivingMin"),
          idleMin: sum("idleMin"),
          trips: sum("trips"),
          speeding: sp.totals.count,
          topSpeedKph: sp.totals.maxSpeedKph,
          leaders: m.byVehicle.filter((v) => v.distanceKm > 0.1).slice(0, 3)
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [timeZone]);

  if (failed) return null;
  const tiles: { icon: IconName; value: string; label: string; color: string }[] = today
    ? [
        { icon: "navigate", value: units.fmtDist(today.distanceKm, 0), label: "Driven", color: colors.primary },
        { icon: "time", value: durationText(today.drivingMin), label: "Driving", color: STATE_META.moving.color },
        { icon: "pause", value: durationText(today.idleMin), label: "Idling", color: STATE_META.idle.color },
        { icon: "speedometer", value: String(today.speeding), label: "Speeding", color: STATE_META.stopped.color }
      ]
    : [];
  const most = today?.leaders[0]?.distanceKm ?? 0;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Ionicons name="layers" size={20} color={colors.primary} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Today across the fleet</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {today && today.topSpeedKph > 0 ? `Top speed ${units.fmtSpeed(today.topSpeedKph)}` : "Activity and driving so far today"}
          </Text>
        </View>
        {today ? (
          <PressableScale onPress={onAll} scaleTo={0.94} style={styles.trips} accessibilityRole="button" accessibilityLabel={`${today.trips} trips today. See vehicles`}>
            <Ionicons name="git-commit-outline" size={15} color={colors.primary} />
            <Text style={styles.tripsText}>{`${today.trips} trip${today.trips === 1 ? "" : "s"}`}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.grid}>
        {today
          ? tiles.map((t) => (
              <View key={t.label} style={[styles.tile, { backgroundColor: isDark ? colors.muted : softTint(t.color, colors.background) }]} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
                {isDark ? null : <LinearGradient colors={[colors.background, softTint(t.color, colors.muted)]} locations={[0, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />}
                <View style={styles.tileHead}>
                  <View style={[styles.chip, { backgroundColor: t.color }]}>
                    <Ionicons name={t.icon} size={15} color="#ffffff" />
                  </View>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </View>
                <Text style={[styles.value, { color: ink(t.color) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {t.value}
                </Text>
              </View>
            ))
          : [0, 1, 2, 3].map((i) => <Skeleton key={i} width="48%" height={88} round={radius.xl} />)}
      </View>

      {today && today.leaders.length > 0 ? (
        <View style={styles.leaders}>
          <View style={styles.leadHead}>
            <Ionicons name="trophy" size={18} color={colors.primary} />
            <Text style={styles.leadTitle}>Drove furthest</Text>
            <PressableScale onPress={onAll} scaleTo={0.94} style={styles.viewAll} accessibilityRole="button">
              <Text style={styles.viewAllText}>All vehicles</Text>
              <Ionicons name="chevron-forward" size={13} color={colors.primary} />
            </PressableScale>
          </View>
          {today.leaders.map((v, i) => {
            const d = byId.get(v.deviceId);
            const st = d ? fleetState(d) : undefined;
            return (
              <PressableScale key={v.deviceId} onPress={() => onVehicle(v.deviceId)} scaleTo={0.985} style={styles.leader} accessibilityRole="button" accessibilityLabel={`${i + 1}. ${v.vehicle}, ${units.fmtDist(v.distanceKm, 0)}. Show on the map`}>
                <View style={[styles.rank, { backgroundColor: MEDAL[i]!.bg }]}>
                  <Text style={[styles.rankText, { color: MEDAL[i]!.fg }]}>{i + 1}</Text>
                </View>
                <VehiclePicture type={d?.vehicle?.type ?? undefined} state={st} width={52} height={38} />
                <View style={styles.leaderBody}>
                  <View style={styles.leaderTop}>
                    <Text style={styles.leaderName} numberOfLines={1}>{v.vehicle}</Text>
                    <Text style={styles.leaderKm}>{units.fmtDist(v.distanceKm, 0)}</Text>
                  </View>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.max(6, Math.round((v.distanceKm / (most || 1)) * 100))}%` }]} />
                  </View>
                </View>
              </PressableScale>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = themed(() => ({
  card: { gap: space.md, ...elevation.sm },
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  headIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: softTint(colors.primary, colors.muted), alignItems: "center" as const, justifyContent: "center" as const },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "800" as const, color: colors.foreground },
  subtitle: { fontSize: 12, lineHeight: 16, color: colors.mutedForeground },
  trips: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, height: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: softTint(colors.primary, colors.muted) },
  tripsText: { fontSize: 13, fontWeight: "800" as const, color: colors.primary },
  grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "space-between" as const, rowGap: space.sm },
  tile: { width: "48.5%" as const, minHeight: 88, overflow: "hidden" as const, padding: 12, gap: 8, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
  fill: { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 },
  tileHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  chip: { width: 28, height: 28, borderRadius: 9, alignItems: "center" as const, justifyContent: "center" as const },
  tileLabel: { fontSize: 13, fontWeight: "700" as const, color: colors.foreground },
  value: { fontSize: 22, lineHeight: 27, fontWeight: "800" as const, fontVariant: ["tabular-nums" as const] },
  leaders: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  leadHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  leadTitle: { flex: 1, fontSize: 15, fontWeight: "800" as const, color: colors.foreground },
  viewAll: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: softTint(colors.primary, colors.muted) },
  viewAllText: { fontSize: 12, fontWeight: "700" as const, color: colors.primary },
  leader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, padding: 8, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  rank: { width: 26, height: 26, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const },
  rankText: { fontSize: 14, fontWeight: "800" as const },
  leaderBody: { flex: 1, minWidth: 0, gap: 6 },
  leaderTop: { flexDirection: "row" as const, alignItems: "baseline" as const, justifyContent: "space-between" as const, gap: 6 },
  leaderName: { flexShrink: 1, fontSize: 15, fontWeight: "800" as const, color: colors.foreground },
  leaderKm: { fontSize: 14, fontWeight: "700" as const, color: colors.foreground, fontVariant: ["tabular-nums" as const] },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" as const },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  quiet: type.small
}));
