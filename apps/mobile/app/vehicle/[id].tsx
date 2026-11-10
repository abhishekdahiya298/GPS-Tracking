import { Ionicons } from "@expo/vector-icons";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, StatusPill, VehicleAvatar } from "@/components/kit";
import { FadeInUp } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { compassPoint, displayName, fleetState, statusLine, timeAgo } from "@/fleet/model";
import { colors, font, radius, space } from "@/theme";

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
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { devices, units } = useFleet();
  const now = useNow();
  const device = devices.find((d) => d.deviceId === id);

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

  const type = device.vehicle?.type;
  const stats: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: string }> = [
    { icon: "speedometer-outline", label: "Speed", value: loc && state !== "offline" && state !== "parked" ? units.fmtSpeed(loc.speedKph) : "—" },
    { icon: "compass-outline", label: "Heading", value: loc?.headingDeg != null && point ? `${point} ${Math.round(loc.headingDeg)}°` : "—" },
    { icon: "key-outline", label: "Engine", value: loc?.ignition === true ? "On" : loc?.ignition === false ? "Off" : "—" }
  ];

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name }} />

      <FadeInUp index={0}>
        <Card>
          <View style={styles.head}>
            <VehicleAvatar type={type} state={state} size={54} />
            <View style={styles.flex}>
              <Text style={styles.name}>{name}</Text>
              {device.vehicle?.licensePlate ? (
                <View style={styles.plate}>
                  <Text style={styles.plateText}>{device.vehicle.licensePlate}</Text>
                </View>
              ) : null}
            </View>
            <StatusPill state={state} compact />
          </View>
          <Text style={styles.summary}>{statusLine(device, units.fmtSpeed, now)}</Text>
        </Card>
      </FadeInUp>

      <FadeInUp index={1} style={styles.stats}>
        {stats.map((s) => (
          <Card key={s.label} style={styles.stat}>
            <Ionicons name={s.icon} size={18} color={colors.primary} />
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </Card>
        ))}
      </FadeInUp>

      <FadeInUp index={2}>
        <Card style={styles.rows}>
          <Row label="Last position" value={loc ? `${timeAgo(loc.recordedAt, now)} · ${new Date(loc.recordedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "None yet"} />
          <Row label="Tracker last heard" value={device.lastSeenAt ? timeAgo(device.lastSeenAt, now) : "Never"} />
          <Row label="Coordinates" value={loc ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}` : "None yet"} />
          {type ? <Row label="Type" value={type.charAt(0).toUpperCase() + type.slice(1)} /> : null}
          {device.model ? <Row label="Tracker" value={device.model} last /> : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={3} style={styles.actions}>
        {loc && hasMap ? <Button title="Show on map" icon="navigate" onPress={() => router.navigate({ pathname: "/(tabs)", params: { device: device.deviceId } })} /> : null}
        <Button variant={loc && hasMap ? "outline" : "primary"} icon="time-outline" title="Trip history" onPress={() => router.push({ pathname: "/trips/[id]", params: { id: device.deviceId } })} />
        {loc ? <Button variant="outline" icon="open-outline" title="Open in Maps" onPress={openInMaps} /> : null}
      </FadeInUp>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  flex: { flex: 1 },
  missing: { flex: 1, backgroundColor: colors.canvas },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { fontSize: 20, fontWeight: "800", color: colors.foreground },
  // Left-aligned under the name (it used to be centred, which looked broken).
  plate: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  plateText: { fontSize: 12, fontWeight: "600", color: colors.mutedForeground, letterSpacing: 0.4 },
  summary: { fontSize: font.body, color: colors.mutedForeground, marginTop: space.md },
  stats: { flexDirection: "row", gap: space.md },
  stat: { flex: 1, padding: space.md, gap: 4 },
  statValue: { fontSize: 20, fontWeight: "800", color: colors.foreground },
  statLabel: { fontSize: 12, color: colors.mutedForeground, fontWeight: "500" },
  rows: { paddingVertical: space.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  label: { fontSize: font.body, color: colors.mutedForeground },
  value: { flex: 1, fontSize: font.body, fontWeight: "500", color: colors.foreground, textAlign: "right" },
  actions: { gap: space.sm, marginTop: space.xs }
});
