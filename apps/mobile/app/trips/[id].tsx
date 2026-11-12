import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ApiError, api } from "@/api";
import { EmptyState, ListSkeleton } from "@/components/kit";
import { FadeInUp, LoadingBar, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { haptic } from "@/haptics";
import { useBottomInset } from "@/layout";
import { useFleet } from "@/fleet/FleetProvider";
import { displayName } from "@/fleet/model";
import { colors, font, radius, size, space, type, themed, type ToneName } from "@/theme";
import { Icon3D } from "@/components/Icon3D";
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
  const bottom = useBottomInset();
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
    <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 12 : 0}>
      <PressableScale
        onPress={() => router.push({ pathname: "/trip", params: { id, from: item.startAt, to: item.endAt, name } })}
        style={styles.trip}
        scaleTo={0.985}
        accessibilityRole="button"
        accessibilityLabel={`Trip from ${fmt.time(item.startAt)} to ${fmt.time(item.endAt)}. Opens the route.`}
      >
        <View style={styles.tripHead}>
          <Icon3D tone="blue" box={30}>
            <Text style={styles.numberText}>{trips.length - index}</Text>
          </Icon3D>
          <Text style={styles.times} numberOfLines={1}>
            {fmt.time(item.startAt)} – {fmt.time(item.endAt)}
          </Text>
          <Text style={[type.small, styles.tabular]}>{durationText(item.durationMin)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
        </View>
        <View style={styles.tripFacts}>
          <TripFact icon="navigate" tone="green" text={units.fmtDist(item.distanceKm)} />
          <TripFact icon="speedometer" tone="violet" text={`Top ${units.fmtSpeed(item.maxSpeedKph)}`} />
          {item.idleMin >= 1 ? <TripFact icon="pause" tone="amber" text={`Idle ${durationText(item.idleMin)}`} /> : null}
        </View>
      </PressableScale>
    </FadeInUp>
  );

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: "Trip history" }} />
      <LoadingBar active={load.state === "loading"} />

      <View style={styles.top}>
        <Text style={[type.small, styles.vehicle]} numberOfLines={1}>{name} · times in {fmt.abbr()}</Text>
        <View style={styles.dayBar}>
          <Pressable
            onPress={() => {
              haptic.tap();
              setDay(shiftDay(day, -1, today));
            }}
            style={styles.arrow}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
          >
            <Ionicons name="chevron-back" size={size.icon} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={() => setDay(today)} style={styles.dayLabel} accessibilityRole="button" accessibilityLabel="Go to today">
            <Ionicons name="calendar-outline" size={18} color={colors.primary} />
            <Text style={styles.dayText}>{dayLabel(day, today)}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              haptic.tap();
              setDay(shiftDay(day, 1, today));
            }}
            disabled={day >= today}
            style={[styles.arrow, day >= today && styles.dim]}
            accessibilityRole="button"
            accessibilityLabel="Next day"
          >
            <Ionicons name="chevron-forward" size={size.icon} color={colors.foreground} />
          </Pressable>
        </View>

        {totals && totals.trips > 0 ? (
          <FadeInUp key={day} distance={6} style={styles.totals}>
            <Total icon="flag" tone="blue" label="Trips" value={String(totals.trips)} />
            <Total icon="navigate" tone="green" label="Distance" value={units.fmtDist(totals.distanceKm)} />
            <Total icon="time" tone="amber" label="Driving" value={durationText(totals.drivingMin)} />
            <Total icon="speedometer" tone="violet" label="Top speed" value={units.fmtSpeed(totals.maxSpeedKph)} />
          </FadeInUp>
        ) : null}
      </View>

      {load.state === "loading" ? (
        <ListSkeleton rows={4} />
      ) : load.state === "failed" ? (
        <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load trips" note={load.message}>
          <Button title="Try again" icon="refresh" onPress={() => void fetchDay()} />
        </EmptyState>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.startAt}
          renderItem={row}
          contentContainerStyle={[trips.length === 0 ? styles.emptyList : styles.list, { paddingBottom: bottom + space.lg }]}
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
          ListEmptyComponent={<EmptyState icon="trail-sign-outline" title="No trips this day" note="The vehicle did not drive, or its tracker was not reporting." />}
        />
      )}
    </View>
  );
}

function Total({ icon, tone, label, value }: { icon: keyof typeof Ionicons.glyphMap; tone: ToneName; label: string; value: string }) {
  return (
    <View style={styles.total}>
      <Icon3D icon={icon} tone={tone} box={28} />
      <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

function TripFact({ icon, tone, text }: { icon: keyof typeof Ionicons.glyphMap; tone: ToneName; text: string }) {
  return (
    <View style={styles.tripFact}>
      <Icon3D icon={icon} tone={tone} box={20} />
      <Text style={[type.small, styles.tabular]}>{text}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  tabular: { fontVariant: ["tabular-nums"] },
  dim: { opacity: 0.3 },
  top: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md },
  vehicle: { textAlign: "center", marginTop: -space.xs },
  dayBar: { flexDirection: "row", alignItems: "center", height: size.control, paddingHorizontal: 2, backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
  arrow: { width: size.controlSm, height: size.controlSm, alignItems: "center", justifyContent: "center" },
  dayLabel: { flex: 1, height: size.controlSm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  dayText: { fontSize: font.body, lineHeight: 20, fontWeight: "600", color: colors.foreground },
  totals: { flexDirection: "row", backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, paddingVertical: space.md, paddingHorizontal: space.sm },
  total: { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 2 },
  totalValue: { fontSize: 17, lineHeight: 22, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  list: { paddingHorizontal: space.lg, gap: space.md },
  emptyList: { flexGrow: 1 },
  trip: { backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  tripHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  numberText: { color: "#ffffff", fontWeight: "800", fontSize: font.small },
  times: { flex: 1, fontSize: font.body, lineHeight: 20, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  tripFacts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: 4, paddingLeft: 24 + space.sm },
  tripFact: { flexDirection: "row", alignItems: "center", gap: 5 }
}));
