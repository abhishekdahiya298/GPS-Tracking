import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { AddressCard, Card, EmptyState, FactRow, IconWell, SpeedBar, StatusPill, VehiclePicture, type IconName } from "@/components/kit";
import { FadeInUp, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, coordsText, displayName, fleetState, freshnessLine, sheetFacts, sheetHeadline, statusLine, timeAgo } from "@/fleet/model";
import { useBottomInset } from "@/layout";
import { MiniFleetMap } from "@/map/MiniFleetMap";
import { useAddress } from "@/map/useAddress";
import { TodayCard } from "@/trips/TodayCard";
import { colors, radius, size, space, themed, type } from "@/theme";

// The map only exists in the installed app (see app/(tabs)/index.tsx).
const hasMap = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

function Row({ icon, color, soft, label, value, last }: { icon: IconName; color?: string; soft?: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <IconWell icon={icon} color={color} soft={soft} box={34} />
      <Text style={[styles.label, styles.flex]}>{label}</Text>
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

  function openInMaps() {
    if (!loc) return;
    const at = `${loc.latitude},${loc.longitude}`;
    const label = encodeURIComponent(name);
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${at}&q=${label}` : `geo:${at}?q=${at}(${label})`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${at}`));
  }

  const kind = device.vehicle?.type;
  const facts = sheetFacts(device, now);
  const silent = state === "offline" || state === "parked" || state === "never_seen";
  const headline = sheetHeadline(device, now);
  const address = useAddress(loc?.latitude, loc?.longitude, state === "moving");
  const speedParts = ((): [string, string] => {
    if (!loc || state === "offline" || state === "never_seen") return ["—", ""];
    const t = units.fmtSpeed(state === "moving" ? loc.speedKph : 0);
    const i = t.lastIndexOf(" ");
    return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 1)];
  })();
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={[styles.content, { paddingBottom: space.xl + bottom }]}>
      <Stack.Screen options={{ title: name }} />

      <FadeInUp index={0}>
        <Card style={styles.hero}>
          <View style={styles.head}>
            <VehiclePicture type={kind} width={104} height={76} />
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={2}>{name}</Text>
              <Text style={type.small} numberOfLines={1}>
                {[kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : null, device.vehicle?.licensePlate].filter(Boolean).join(" · ") || statusLine(device, units.fmtSpeed, now)}
              </Text>
              <View style={styles.pillLine}>
                <StatusPill state={state} compact />
              </View>
            </View>
          </View>
          <SpeedBar speed={speedParts[0]} unit={speedParts[1]} title={headline.title} detail={headline.detail} headingDeg={loc?.headingDeg ?? null} state={state === "never_seen" ? "offline" : state} />
          <FactRow facts={facts} />
        </Card>
      </FadeInUp>

      <FadeInUp index={1}>
        <Card style={styles.place}>
          {loc && hasMap ? (
            <PressableScale onPress={() => router.navigate({ pathname: "/(tabs)", params: { device: device.deviceId } })} scaleTo={0.99} style={styles.miniMap} accessibilityRole="button" accessibilityLabel="Show on the live map">
              <MiniFleetMap devices={[device]} focus={[loc.longitude, loc.latitude]} />
            </PressableScale>
          ) : null}
          <AddressCard title={address?.line1 ?? null} line={address?.line2} coords={coordsText(device) ?? "No position yet"} label={loc ? (silent ? `Last known position · ${freshnessLine(device, now)}` : freshnessLine(device, now)) : undefined} />
          {loc ? (
            <View style={styles.placeActions}>
              {hasMap ? (
                <View style={styles.flex}>
                  <Button compact title="Show on map" icon="map-outline" onPress={() => router.navigate({ pathname: "/(tabs)", params: { device: device.deviceId } })} />
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
          <Row icon="location-outline" label="Last position" value={loc ? new Date(loc.recordedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "None yet"} />
          <Row icon="pulse-outline" color={STATE_META.moving.color} soft={STATE_META.moving.soft} label="Tracker last heard" value={device.lastSeenAt ? timeAgo(device.lastSeenAt, now) : "Never"} last={!kind && !device.model} />
          {kind ? <Row icon="car-outline" color={STATE_META.parked.color} soft={STATE_META.parked.soft} label="Type" value={kind.charAt(0).toUpperCase() + kind.slice(1)} last={!device.model} /> : null}
          {device.model ? <Row icon="hardware-chip-outline" color={STATE_META.offline.color} soft={STATE_META.offline.soft} label="Tracker" value={device.model} last /> : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={3}>
        <TodayCard deviceId={device.deviceId} name={name} />
      </FadeInUp>
    </ScrollView>
  );
}

const styles = themed(() => ({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ["tabular-nums"] },
  missing: { flex: 1, backgroundColor: colors.canvas },
  hero: { padding: 14, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2, color: colors.foreground },
  pillLine: { flexDirection: "row", marginTop: 4 },
  stats: { flexDirection: "row", gap: 6 },
  place: { padding: space.sm, gap: space.sm },
  placeActions: { flexDirection: "row", gap: space.sm },
  miniMap: { height: 150, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.muted },
  rows: { paddingVertical: 0, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.control, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  label: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
  value: { flexShrink: 1, maxWidth: "60%", fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground, textAlign: "right", fontVariant: ["tabular-nums"] },
  linkCard: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingLeft: space.md, paddingRight: 10, backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border }
}));
