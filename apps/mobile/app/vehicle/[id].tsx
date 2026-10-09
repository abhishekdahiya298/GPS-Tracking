import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, compassPoint, displayName, fleetState, statusLine, timeAgo } from "@/fleet/model";
import { colors, font, radius, space } from "@/theme";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { devices, units } = useFleet();
  const now = useNow();
  const device = devices.find((d) => d.deviceId === id);

  if (!device) {
    return (
      <View style={styles.missing}>
        <Stack.Screen options={{ title: "Vehicle" }} />
        <Ionicons name="help-circle-outline" size={36} color={colors.offline} />
        <Text style={styles.name}>Vehicle not found</Text>
        <Text style={styles.sub}>It may have been removed. Go back to the list.</Text>
      </View>
    );
  }

  const state = fleetState(device);
  const meta = STATE_META[state];
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

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name }} />

      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            {device.vehicle?.licensePlate ? <Text style={styles.sub}>{device.vehicle.licensePlate}</Text> : null}
          </View>
          <View style={[styles.pill, { backgroundColor: meta.soft }]}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.summary}>{statusLine(device, units.fmtSpeed, now)}</Text>
      </View>

      <View style={styles.card}>
        <Row label="Speed" value={loc && state !== "offline" ? units.fmtSpeed(loc.speedKph) : "Not available"} />
        <Row label="Heading" value={loc?.headingDeg != null && point ? `${point} (${Math.round(loc.headingDeg)}°)` : "Not available"} />
        <Row label="Engine" value={loc?.ignition === true ? "On" : loc?.ignition === false ? "Off" : "Not reported"} />
        <Row label="Last position" value={loc ? `${timeAgo(loc.recordedAt, now)} · ${new Date(loc.recordedAt).toLocaleString()}` : "None yet"} />
        <Row label="Tracker last heard" value={device.lastSeenAt ? timeAgo(device.lastSeenAt, now) : "Never"} />
        <Row label="Coordinates" value={loc ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}` : "None yet"} />
        {device.vehicle ? <Row label="Type" value={device.vehicle.type.charAt(0).toUpperCase() + device.vehicle.type.slice(1)} /> : null}
        {device.model ? <Row label="Tracker" value={device.model} /> : null}
      </View>

      {loc ? <Button title="Open in Maps" onPress={openInMaps} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
  flex: { flex: 1 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl, backgroundColor: colors.canvas },
  card: { backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  name: { fontSize: font.title, fontWeight: "700", color: colors.foreground },
  sub: { fontSize: font.body, color: colors.mutedForeground, marginTop: 2, textAlign: "center" },
  summary: { fontSize: font.body, color: colors.foreground, marginTop: space.md },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.lg, paddingVertical: space.sm },
  label: { fontSize: font.body, color: colors.mutedForeground },
  value: { flex: 1, fontSize: font.body, color: colors.foreground, textAlign: "right" }
});
