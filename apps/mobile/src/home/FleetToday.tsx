import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api";
import { Card, type IconName } from "@/components/kit";
import { Skeleton } from "@/components/motion";
import { useFleet } from "@/fleet/FleetProvider";
import { STATE_META } from "@/fleet/model";
import { dayRange, durationText, todayKey } from "@/trips/model";
import { colors, ink, radius, softTint, space, themed, type } from "@/theme";

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

/**
 * Overview → "Today across the fleet": distance, driving and idle time, trips and speeding,
 * from the server's mileage and speeding reports for today (nothing made up), plus the three
 * vehicles that drove furthest. Quietly hidden if the account can't read history.
 */
export function FleetToday({ onVehicle }: { onVehicle: (deviceId: string) => void }) {
  const { units, timeZone } = useFleet();
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);

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
        { icon: "navigate-outline", value: units.fmtDist(today.distanceKm, 0), label: "Driven", color: colors.primary },
        { icon: "time-outline", value: durationText(today.drivingMin), label: "Driving", color: STATE_META.moving.color },
        { icon: "pause-circle-outline", value: durationText(today.idleMin), label: "Idling", color: STATE_META.idle.color },
        { icon: "speedometer-outline", value: String(today.speeding), label: "Speeding", color: STATE_META.stopped.color }
      ]
    : [];
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={type.label}>TODAY ACROSS THE FLEET</Text>
        {today ? <Text style={styles.meta}>{`${today.trips} trip${today.trips === 1 ? "" : "s"}`}</Text> : null}
      </View>
      <View style={styles.grid}>
        {today
          ? tiles.map((t) => (
              <View key={t.label} style={[styles.tile, { backgroundColor: softTint(t.color, colors.muted) }]} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
                <Ionicons name={t.icon} size={16} color={ink(t.color)} />
                <Text style={[styles.value, { color: ink(t.color) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {t.value}
                </Text>
                <Text style={styles.label}>{t.label}</Text>
              </View>
            ))
          : [0, 1, 2, 3].map((i) => <Skeleton key={i} width="23%" height={70} />)}
      </View>
      {today && today.leaders.length > 0 ? (
        <View style={styles.leaders}>
          <Text style={styles.leadersTitle}>Drove furthest</Text>
          {today.leaders.map((v, i) => (
            <Text key={v.deviceId} style={styles.leader} numberOfLines={1} onPress={() => onVehicle(v.deviceId)} accessibilityRole="button">
              <Text style={styles.rank}>{`${i + 1}  `}</Text>
              {v.vehicle}
              <Text style={styles.leaderKm}>{`  ${units.fmtDist(v.distanceKm, 0)}`}</Text>
            </Text>
          ))}
        </View>
      ) : null}
      {today && today.topSpeedKph > 0 ? <Text style={styles.meta}>{`Top speed today ${units.fmtSpeed(today.topSpeedKph)}`}</Text> : null}
    </Card>
  );
}

const styles = themed(() => ({
  card: { gap: space.sm },
  head: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  meta: { fontSize: 12, lineHeight: 16, color: colors.mutedForeground, fontWeight: "600" as const },
  grid: { flexDirection: "row" as const, gap: 6 },
  tile: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: 2, paddingVertical: 9, borderRadius: radius.lg },
  value: { fontSize: 16, lineHeight: 20, fontWeight: "800" as const, fontVariant: ["tabular-nums" as const] },
  label: { fontSize: 11, lineHeight: 13, fontWeight: "600" as const, color: colors.mutedForeground },
  leaders: { gap: 4, paddingTop: 2 },
  leadersTitle: { fontSize: 12, lineHeight: 16, fontWeight: "700" as const, color: colors.mutedForeground },
  leader: { fontSize: 14, lineHeight: 20, fontWeight: "700" as const, color: colors.foreground },
  rank: { color: colors.primary, fontWeight: "800" as const },
  leaderKm: { color: colors.mutedForeground, fontWeight: "600" as const }
}));
