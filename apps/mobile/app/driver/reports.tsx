import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { driver, type DriverStats, type StatsRange } from "@/driver/api";
import { ago, hoursMinutes } from "@/driver/model";
import { driverStyles as ds } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" }
];
const KM_PER_MI = 1.609344;

/** R9: how much the driver drove (today, week, month), split by company. */
export default function DriverReports() {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<StatsRange>("today");
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Drivers in North America think in miles.
  const [miles, setMiles] = useState(true);

  const load = useCallback(async () => {
    try {
      setStats(await driver.stats(range));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your reports.");
    }
  }, [range]);
  useEffect(() => {
    setStats(null);
    void load();
  }, [load]);

  const dist = (km: number) => (miles ? `${(km / KM_PER_MI).toFixed(km / KM_PER_MI >= 100 ? 0 : 1)} mi` : `${km.toFixed(km >= 100 ? 0 : 1)} km`);
  const peak = stats ? Math.max(1, ...stats.days.map((d) => d.distanceKm)) : 1;

  return (
    <ScrollView
      style={ds.screen}
      contentContainerStyle={[ds.body, { paddingTop: space.lg, paddingBottom: insets.bottom + space.xl }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.seg} accessibilityRole="tablist">
        {RANGES.map((r) => (
          <Pressable key={r.value} onPress={() => setRange(r.value)} style={[styles.segBtn, range === r.value && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: range === r.value }}>
            <Text style={[styles.segText, range === r.value && styles.segTextOn]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!stats && !error ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : null}

      {stats ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{range === "today" ? "DROVE TODAY" : range === "week" ? "LAST 7 DAYS" : "LAST 30 DAYS"}</Text>
            <Pressable onPress={() => setMiles((m) => !m)} accessibilityRole="button" accessibilityLabel="Switch miles and kilometres">
              <Text style={styles.heroValue}>{dist(stats.totals.distanceKm)}</Text>
            </Pressable>
            <View style={styles.facts}>
              <Fact value={hoursMinutes(stats.totals.drivingMin)} label="Driving" />
              <Fact value={String(stats.totals.trips)} label={stats.totals.trips === 1 ? "Trip" : "Trips"} />
              <Fact value={hoursMinutes(stats.totals.idleMin)} label="Idling" />
            </View>
          </View>

          {range !== "today" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Each day</Text>
              <View style={styles.chart}>
                {stats.days.map((d) => (
                  <View key={d.day} style={styles.col} accessibilityLabel={`${d.day}: ${dist(d.distanceKm)}`}>
                    <View style={[styles.bar, { height: Math.max(2, (d.distanceKm / peak) * 110), backgroundColor: d.distanceKm ? colors.primary : colors.border }]} />
                  </View>
                ))}
              </View>
              <View style={styles.axis}>
                <Text style={styles.axisText}>{shortDay(stats.from)}</Text>
                <Text style={styles.axisText}>{shortDay(stats.to)}</Text>
              </View>
              <Text style={styles.sub}>
                Drove on {stats.totals.daysDriven} of {stats.days.length} days
                {stats.totals.maxSpeedKph ? ` · top speed ${miles ? `${Math.round(stats.totals.maxSpeedKph / KM_PER_MI)} mph` : `${stats.totals.maxSpeedKph} km/h`}` : ""}
              </Text>
            </View>
          ) : null}

          {stats.byCompany.length > 1 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>By company</Text>
              {stats.byCompany.map((c) => (
                <View key={c.company.id} style={styles.row}>
                  <Ionicons name="business-outline" size={18} color={colors.primary} />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {c.company.name}
                  </Text>
                  <Text style={styles.rowValue}>{dist(c.distanceKm)}</Text>
                  <Text style={styles.rowSub}>{hoursMinutes(c.drivingMin)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {stats.totals.distanceKm === 0 ? <Text style={styles.sub}>No driving recorded for this period yet. Trips show here a few minutes after you drive with the app signed in.</Text> : null}
          <Text style={styles.fine}>From your phone&apos;s location while signed in. {stats.updatedAt ? `Updated ${ago(stats.updatedAt)}.` : "Updates every few minutes."}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

const styles = themed(() => ({
  seg: { flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: colors.primary },
  segText: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  segTextOn: { color: "#ffffff" },
  hero: { gap: space.sm, padding: 16, borderRadius: 20, backgroundColor: "#13286b" },
  heroLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: "rgba(255,255,255,0.75)" },
  heroValue: { fontSize: 38, fontWeight: "800", color: "#ffffff", letterSpacing: -0.8 },
  facts: { flexDirection: "row", gap: space.sm },
  fact: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)" },
  factValue: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
  factLabel: { fontSize: 11.5, color: "rgba(255,255,255,0.75)" },
  card: { gap: space.sm, padding: 14, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 116, gap: 2 },
  col: { flex: 1, alignItems: "stretch", justifyContent: "flex-end" },
  bar: { borderRadius: 3 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11, color: colors.mutedForeground },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  rowName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.foreground },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  rowSub: { fontSize: 12, color: colors.mutedForeground, minWidth: 64, textAlign: "right" },
  sub: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  error: { fontSize: 14, color: colors.danger },
  fine: { fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground, textAlign: "center" }
}));
