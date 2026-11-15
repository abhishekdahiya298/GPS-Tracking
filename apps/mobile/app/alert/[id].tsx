import { Ionicons } from "@expo/vector-icons";
import { dateFormatter } from "@rio-gps/core/timezones";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAlerts } from "@/alerts/AlertsProvider";
import { SEVERITY_META, alertDetail, alertMeta, alertSeverity, alertTitle } from "@/alerts/model";
import { AddressCard, Card, EmptyState, IconWell } from "@/components/kit";
import { FadeInUp } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, timeAgo } from "@/fleet/model";
import { haptic } from "@/haptics";
import { useBottomInset } from "@/layout";
import { colors, ink, radius, softTint, space, themed, type } from "@/theme";

/**
 * One alert in full: what happened, how urgent it is, when and where, the rule that raised it,
 * and the way to the vehicle. Everything shown comes from the alert as the server stored it.
 */
export default function AlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bottom = useBottomInset();
  const now = useNow();
  const { events, acknowledge } = useAlerts();
  const { units, devices, timeZone, timeFormat } = useFleet();
  const fmt = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);
  const [busy, setBusy] = useState(false);
  const event = events.find((e) => String(e.id) === id);

  if (!event) {
    return (
      <View style={styles.wrap}>
        <Stack.Screen options={{ title: "Alert" }} />
        <EmptyState icon="notifications-off-outline" title="Alert not found" note="It may be older than the alerts loaded on this phone. Go back to the list." />
      </View>
    );
  }

  const meta = alertMeta(event.type);
  const sev = SEVERITY_META[alertSeverity(event.type)];
  const detail = alertDetail(event, units.fmtSpeed);
  const known = event.deviceId !== null && devices.some((d) => d.deviceId === event.deviceId);
  const hasPlace = event.latitude !== null && event.longitude !== null;
  const coords = hasPlace ? `${event.latitude!.toFixed(4)}, ${event.longitude!.toFixed(4)}` : null;

  async function markRead() {
    setBusy(true);
    const problem = await acknowledge([event!.id]);
    setBusy(false);
    if (problem) Alert.alert("Couldn't mark as read", problem);
    else haptic.success();
  }

  function openInMaps() {
    if (!coords) return;
    const at = `${event!.latitude},${event!.longitude}`;
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${at}&q=${encodeURIComponent(meta.label)}` : `geo:${at}?q=${at}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${at}`));
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={[styles.content, { paddingBottom: space.xl + bottom }]}>
      <Stack.Screen options={{ title: meta.label }} />
      <FadeInUp index={0}>
        <Card style={styles.hero}>
          <IconWell icon={meta.icon} color={meta.color} soft={meta.soft} box={52} />
          <View style={[styles.tag, { backgroundColor: softTint(sev.color, sev.soft) }]}>
            <Text style={[styles.tagText, { color: ink(sev.color) }]}>{`${sev.label} priority`}</Text>
          </View>
          <Text style={styles.title}>{alertTitle(event)}</Text>
          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          <Text style={type.small}>{`${fmt.full(Date.parse(event.occurredAt))} · ${timeAgo(event.occurredAt, now)}`}</Text>
        </Card>
      </FadeInUp>

      {coords ? (
        <FadeInUp index={1}>
          <Card style={styles.place}>
            <AddressCard title={null} coords={coords} label="Where it happened" />
            <Button compact variant="outline" title="Open in Maps" icon="navigate-outline" onPress={openInMaps} />
          </Card>
        </FadeInUp>
      ) : null}

      <FadeInUp index={2}>
        <Card style={styles.rows}>
          <Row icon="pricetag-outline" label="Type" value={meta.label} />
          <Row icon="options-outline" color={STATE_META.idle.color} soft={STATE_META.idle.soft} label="Rule" value={event.ruleName || "—"} />
          <Row icon="car-outline" color={STATE_META.parked.color} soft={STATE_META.parked.soft} label="Vehicle" value={event.vehicleName ?? "—"} />
          <Row icon="checkmark-done-outline" color={event.acknowledgedAt ? STATE_META.moving.color : colors.primary} soft={event.acknowledgedAt ? STATE_META.moving.soft : colors.primarySoft} label="Status" value={event.acknowledgedAt ? `Read ${timeAgo(event.acknowledgedAt, now)}` : "Unread"} last />
        </Card>
      </FadeInUp>

      <FadeInUp index={3} style={styles.actions}>
        {known ? <Button title="View vehicle" icon="car-outline" onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: event.deviceId! } })} /> : null}
        {!event.acknowledgedAt ? <Button variant="outline" title="Mark as read" icon="checkmark-circle-outline" onPress={() => void markRead()} loading={busy} /> : null}
      </FadeInUp>
    </ScrollView>
  );
}

function Row({ icon, label, value, color, soft, last = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color?: string; soft?: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <IconWell icon={icon} color={color} soft={soft} box={34} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2} selectable>{value}</Text>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  hero: { alignItems: "center", gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  tagText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.foreground, textAlign: "center" },
  detail: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.foreground, textAlign: "center", fontVariant: ["tabular-nums"] },
  place: { padding: space.sm, gap: space.sm },
  rows: { paddingVertical: 0, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground, width: 72 },
  rowValue: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground, textAlign: "right" },
  actions: { gap: space.sm, borderRadius: radius.lg }
}));
