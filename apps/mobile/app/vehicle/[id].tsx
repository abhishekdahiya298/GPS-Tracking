import { Ionicons } from "@expo/vector-icons";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAddress } from "@/address/useAddress";
import { Icon3D } from "@/components/Icon3D";
import { Card, EmptyState, IconWell, StatusPill, VehicleAvatar } from "@/components/kit";
import { FadeInUp, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { compassPoint, displayName, fleetState, statusLine, timeAgo } from "@/fleet/model";
import { useBottomInset } from "@/layout";
import { colors, radius, size, space, type, themed } from "@/theme";

// The map only exists in the installed app (see app/(tabs)/index.tsx).
const hasMap = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

export default function VehicleScreen() {
  const bottom = useBottomInset();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { devices, units } = useFleet();
  const now = useNow();
  const device = devices.find((d) => d.deviceId === id);
  const address = useAddress(device?.location?.latitude, device?.location?.longitude);

  if (!device) {
    return (
      <View style={styles.missing}>
        <Stack.Screen options={{ title: "Vehicle" }} />
        <EmptyState icon="help-circle-outline" title="Vehicle not found" note="It may have been removed. Go back to the list." />
      </View>
    );
  }

  const state = fleetState(device);
  const loc = device.location;
  const name = displayName(device);
  const point = compassPoint(loc?.headingDeg ?? null);

  function openInMaps() {
    if (!loc) return;
    const at = `${loc.latitude},${loc.longitude}`;
    const label = encodeURIComponent(name);
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${at}&q=${label}` : `geo:${at}?q=${at}(${label})`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${at}`));
  }

  const kind = device.vehicle?.type;
  const stats: Array<{ icon: keyof typeof Ionicons.glyphMap; tone: "blue" | "violet" | "amber"; label: string; value: string }> = [
    { icon: "speedometer", tone: "blue", label: "Speed", value: loc && state !== "offline" && state !== "parked" ? units.fmtSpeed(loc.speedKph) : "—" },
    { icon: "compass", tone: "violet", label: "Heading", value: loc?.headingDeg != null && point ? `${point} ${Math.round(loc.headingDeg)}°` : "—" },
    { icon: "key", tone: "amber", label: "Engine", value: loc?.ignition === true ? "On" : loc?.ignition === false ? "Off" : "—" }
  ];

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={[styles.content, { paddingBottom: space.xl + bottom }]}>
      <Stack.Screen options={{ title: name }} />

      <FadeInUp index={0}>
        <Card style={styles.hero}>
          <View style={styles.head}>
            <VehicleAvatar type={kind} state={state} size={52} />
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={2}>{name}</Text>
              <Text style={type.small} numberOfLines={1}>
                {[kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : null, device.vehicle?.licensePlate].filter(Boolean).join(" · ") || statusLine(device, units.fmtSpeed, now)}
              </Text>
            </View>
            <StatusPill state={state} compact />
          </View>
          <View style={styles.rule} />
          <View style={styles.stats}>
            {stats.map((s) => (
              <View key={s.label} style={styles.stat}>
                <View style={styles.statHead}>
                  <Icon3D icon={s.icon} tone={s.tone} box={22} />
                  <Text style={type.caption}>{s.label}</Text>
                </View>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
              </View>
            ))}
          </View>
        </Card>
      </FadeInUp>

      <FadeInUp index={1}>
        <Card style={styles.place}>
          <View style={styles.placeHead}>
            <IconWell icon="location" color="#dc2626" />
            <View style={styles.flex}>
              <Text style={type.rowTitle}>{loc ? `Last position ${timeAgo(loc.recordedAt, now)}` : "No position yet"}</Text>
              {address ? <Text style={styles.address} selectable>{address}</Text> : null}
              <Text style={[type.small, styles.tabular]} selectable>
                {loc ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}` : "This tracker has not reported a position."}
              </Text>
            </View>
          </View>
          {loc ? (
            <View style={styles.placeActions}>
              {hasMap ? (
                <View style={styles.flex}>
                  <Button compact title="Show on map" icon="map-outline" onPress={() => router.navigate({ pathname: "/(tabs)/map", params: { device: device.deviceId } })} />
                </View>
              ) : null}
              <View style={styles.flex}>
                <Button compact variant="outline" title="Open in Maps" icon="navigate-outline" onPress={openInMaps} />
              </View>
            </View>
          ) : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={2}>
        <Card style={styles.rows}>
          <Row label="Last position" value={loc ? new Date(loc.recordedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "None yet"} />
          <Row label="Tracker last heard" value={device.lastSeenAt ? timeAgo(device.lastSeenAt, now) : "Never"} last={!kind && !device.model} />
          {kind ? <Row label="Type" value={kind.charAt(0).toUpperCase() + kind.slice(1)} last={!device.model} /> : null}
          {device.model ? <Row label="Tracker" value={device.model} last /> : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={3}>
        <PressableScale onPress={() => router.push({ pathname: "/trips/[id]", params: { id: device.deviceId } })} scaleTo={0.985} style={styles.linkCard} accessibilityRole="button" accessibilityLabel="Trip history">
          <IconWell icon="trail-sign" color="#6d28d9" box={36} />
          <Text style={[type.rowTitle, styles.flex]}>Trip history</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
        </PressableScale>
      </FadeInUp>
    </ScrollView>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ["tabular-nums"] },
  missing: { flex: 1, backgroundColor: colors.canvas },
  hero: { padding: 14, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  stats: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, gap: 4 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  statValue: { fontSize: 17, lineHeight: 22, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  place: { padding: 14, gap: space.md },
  placeHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  placeActions: { flexDirection: "row", gap: space.sm },
  rows: { paddingVertical: 0, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.lg, minHeight: size.control, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  address: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground, marginTop: 2 },
  label: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
  value: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground, textAlign: "right", fontVariant: ["tabular-nums"] },
  linkCard: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingLeft: space.md, paddingRight: 10, backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border }
}));
