import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ApiError, api } from "@/api";
import { Button } from "@/components/ui";
import { useFleet } from "@/fleet/FleetProvider";
import { displayName } from "@/fleet/model";
import { colors, font, space } from "@/theme";
import { dayLabel, dayRange, durationText, shiftDay, todayKey, type TripDto, type TripReport } from "@/trips/model";

type Load = { state: "loading" } | { state: "ready"; report: TripReport } | { state: "failed"; message: string };

export default function TripsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { devices, units, timeZone, timeFormat } = useFleet();
  const device = devices.find((d) => d.deviceId === id);
  const name = device ? displayName(device) : "Vehicle";
  const today = todayKey(timeZone);
  const [day, setDay] = useState(today);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [pulling, setPulling] = useState(false);
  const fmt = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);

  const fetchDay = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoad({ state: "loading" });
      try {
        const { from, to } = dayRange(day, timeZone);
        const report = await api.get<TripReport>("reports/trips", { deviceId: id, from, to, tz: timeZone });
        setLoad({ state: "ready", report });
      } catch (e) {
        if (e instanceof ApiError && e.kind === "unauthorized") return;
        setLoad({ state: "failed", message: e instanceof ApiError ? (e.kind === "forbidden" ? "Your account can't view trip history." : e.kind === "not_found" ? "This vehicle is no longer available." : e.message) : "Something went wrong." });
      }
    },
    [day, id, timeZone]
  );

  useEffect(() => {
    void fetchDay();
  }, [fetchDay]);

  const trips = load.state === "ready" ? [...load.report.trips].reverse() : [];
  const totals = load.state === "ready" ? load.report.totals : null;

  const row = ({ item, index }: { item: TripDto; index: number }) => (
    <Pressable
      onPress={() => router.push({ pathname: "/trip", params: { id, from: item.startAt, to: item.endAt, name } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
      accessibilityRole="button"
      accessibilityLabel={`Trip from ${fmt.time(item.startAt)} to ${fmt.time(item.endAt)}`}
    >
      <View style={styles.number}>
        <Text style={styles.numberText}>{trips.length - index}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.times}>
          {fmt.time(item.startAt)} to {fmt.time(item.endAt)}
        </Text>
        <Text style={styles.sub}>
          {units.fmtDist(item.distanceKm)} · {durationText(item.durationMin)}
          {item.idleMin >= 1 ? ` · idle ${durationText(item.idleMin)}` : ""}
        </Text>
        <Text style={styles.sub}>Top speed {units.fmtSpeed(item.maxSpeedKph)}</Text>
      </View>
      <Ionicons name="play-circle-outline" size={28} color={colors.primary} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: `${name} trips` }} />

      <View style={styles.dayBar}>
        <Pressable onPress={() => setDay(shiftDay(day, -1, today))} hitSlop={8} style={styles.arrow} accessibilityRole="button" accessibilityLabel="Previous day">
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => setDay(today)} style={styles.dayLabel} accessibilityRole="button" accessibilityLabel="Go to today">
          <Text style={styles.dayText}>{dayLabel(day, today)}</Text>
          <Text style={styles.zone}>Times in {fmt.abbr()}</Text>
        </Pressable>
        <Pressable onPress={() => setDay(shiftDay(day, 1, today))} disabled={day >= today} hitSlop={8} style={[styles.arrow, day >= today && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Next day">
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {totals && totals.trips > 0 ? (
        <View style={styles.totals}>
          <Total label="Trips" value={String(totals.trips)} />
          <Total label="Distance" value={units.fmtDist(totals.distanceKm)} />
          <Total label="Driving" value={durationText(totals.drivingMin)} />
          <Total label="Top speed" value={units.fmtSpeed(totals.maxSpeedKph)} />
        </View>
      ) : null}

      {load.state === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : load.state === "failed" ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.offline} />
          <Text style={styles.emptyTitle}>Can't load trips</Text>
          <Text style={styles.muted}>{load.message}</Text>
          <View style={styles.retry}>
            <Button title="Try again" onPress={() => void fetchDay()} />
          </View>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.startAt}
          renderItem={row}
          ItemSeparatorComponent={() => <View style={styles.line} />}
          contentContainerStyle={trips.length === 0 ? styles.emptyList : undefined}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              tintColor={colors.primary}
              colors={[colors.primary]}
              onRefresh={async () => {
                setPulling(true);
                await fetchDay(true);
                setPulling(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="trail-sign-outline" size={36} color={colors.offline} />
              <Text style={styles.emptyTitle}>No trips this day</Text>
              <Text style={styles.muted}>The vehicle did not drive, or its tracker was not reporting.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  dayBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dayLabel: { flex: 1, alignItems: "center" },
  dayText: { fontSize: font.title, fontWeight: "600", color: colors.foreground },
  zone: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  totals: { flexDirection: "row", backgroundColor: colors.canvas, paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  total: { flex: 1, alignItems: "center", paddingHorizontal: 2 },
  totalValue: { fontSize: font.body, fontWeight: "700", color: colors.foreground },
  totalLabel: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  retry: { marginTop: space.md, alignSelf: "stretch" },
  emptyList: { flexGrow: 1 },
  emptyTitle: { fontSize: font.title, fontWeight: "600", color: colors.foreground, marginTop: space.sm },
  muted: { fontSize: font.body, color: colors.mutedForeground, textAlign: "center", lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  number: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.primary, fontWeight: "700", fontSize: font.small },
  times: { fontSize: font.body, fontWeight: "600", color: colors.foreground },
  sub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2 },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg + 32 + space.md }
});
