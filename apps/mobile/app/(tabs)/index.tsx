import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertMeta, alertTitle } from "@/alerts/model";
import { useSession } from "@/auth/SessionProvider";
import { Banner, Card } from "@/components/kit";
import { FadeInUp, PressableScale, PulseDot, Skeleton } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { ROW_INSET, VehicleRow } from "@/fleet/VehicleRow";
import { firstName, fleetSummary, greeting, onTheMove } from "@/home/model";
import { Welcome } from "@/home/Welcome";
import { colors, elevation, font, gradient, ink, softTint, space } from "@/theme";

const LOGO = require("../../assets/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports -- React Native loads images with require()

/** Home: the fleet at a glance. Status counts, who is on the move, and the latest alerts. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useSession();
  const { devices, loading, error, connection, units, refresh } = useFleet();
  const { events, unread, refresh: refreshAlerts } = useAlerts();
  const now = useNow();
  const [pulling, setPulling] = useState(false);

  const user = state.status === "signedIn" ? state.user : null;
  const summary = useMemo(() => fleetSummary(devices), [devices]);
  const moving = useMemo(() => onTheMove(devices, 4), [devices]);
  const latest = events.slice(0, 3);
  const name = firstName(user?.name);
  const live = connection === "live";

  async function onPull() {
    setPulling(true);
    await Promise.all([refresh(), refreshAlerts()]);
    setPulling(false);
  }

  const openMap = (deviceId?: string) => router.navigate(deviceId ? { pathname: "/(tabs)/map", params: { device: deviceId } } : "/(tabs)/map");

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor="#ffffff" colors={[colors.primary]} progressViewOffset={insets.top} />}
      >
        {/* Brand header with the fleet total and a bar split by status. */}
        <LinearGradient colors={gradient.brand} start={gradient.angle.start} end={gradient.angle.end} style={[styles.hero, { paddingTop: insets.top + space.md }]}>
          <View style={styles.heroTop}>
            <View style={styles.logoChip}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
            </View>
            <View style={styles.liveChip}>
              <PulseDot size={8} color={live ? "#4ade80" : "#fbbf24"} live={live} />
              <Text style={styles.liveText}>{live ? "Live" : error ? "Offline" : "Updating"}</Text>
            </View>
          </View>
          <Text style={styles.hello}>
            {greeting(new Date(now).getHours())}
            {name ? `, ${name}` : ""}
          </Text>
          <View style={styles.totalLine}>
            <Text style={styles.total}>{loading ? "–" : summary.total}</Text>
            <Text style={styles.totalLabel}>{summary.total === 1 ? "vehicle" : "vehicles"} in your fleet</Text>
          </View>
          <View style={styles.bar} accessibilityLabel={summary.parts.map((p) => `${p.count} ${p.label}`).join(", ")}>
            {summary.total === 0 ? <View style={[styles.barPart, { flex: 1, backgroundColor: "rgba(255,255,255,0.25)" }]} /> : null}
            {summary.parts
              .filter((p) => p.count > 0)
              .map((p) => (
                <View key={p.key} style={[styles.barPart, { flex: p.count, backgroundColor: BAR[p.key] }]} />
              ))}
          </View>
        </LinearGradient>

        <View style={styles.body}>
          {error && devices.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

          {/* Four status tiles. Each opens the vehicle list with that filter. */}
          <FadeInUp index={0} style={styles.tiles}>
            {summary.parts.map((p) => (
              <PressableScale
                key={p.key}
                onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: p.key } })}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={`${p.count} ${p.label}. Show them.`}
              >
                <View style={styles.tileHead}>
                  <PulseDot size={9} color={ink(p.color)} live={p.key === "moving" && p.count > 0} />
                  <Text style={styles.tileLabel}>{p.label}</Text>
                </View>
                {loading ? <Skeleton width={36} height={30} /> : <Text style={[styles.tileCount, p.count > 0 && { color: ink(p.color) }]}>{p.count}</Text>}
              </PressableScale>
            ))}
          </FadeInUp>

          <FadeInUp index={1}>
            <PressableScale onPress={() => openMap()} feedback="press" style={styles.mapButton} accessibilityRole="button" accessibilityLabel="Open the live map">
              <View style={styles.mapIcon}>
                <Ionicons name="map" size={20} color={colors.primaryForeground} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.mapTitle}>Live map</Text>
                <Text style={styles.mapNote}>See every vehicle, find one, follow it</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.primary} />
            </PressableScale>
          </FadeInUp>

          <FadeInUp index={2}>
            <SectionHead title="On the move" action={moving.length > 0 ? "All vehicles" : undefined} onAction={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: "moving" } })} />
            <Card style={styles.listCard}>
              {loading ? (
                <View style={styles.pad}>
                  <Skeleton width="70%" height={16} />
                </View>
              ) : moving.length === 0 ? (
                <Text style={styles.quiet}>No vehicle is moving right now.</Text>
              ) : (
                moving.map((d, i) => (
                  <View key={d.deviceId}>
                    {i > 0 ? <View style={styles.line} /> : null}
                    <VehicleRow device={d} fmtSpeed={units.fmtSpeed} now={now} onPress={openMap} />
                  </View>
                ))
              )}
            </Card>
          </FadeInUp>

          <FadeInUp index={3}>
            <SectionHead title={unread > 0 ? `Latest alerts · ${unread} unread` : "Latest alerts"} action={latest.length > 0 ? "All alerts" : undefined} onAction={() => router.navigate("/(tabs)/alerts")} />
            <Card style={styles.listCard}>
              {latest.length === 0 ? (
                <Text style={styles.quiet}>No alerts yet. Alert rules are set up on the website.</Text>
              ) : (
                latest.map((e, i) => {
                  const meta = alertMeta(e.type);
                  return (
                    <View key={e.id}>
                      {i > 0 ? <View style={[styles.line, { marginLeft: space.lg + 38 + space.md }]} /> : null}
                      <PressableScale onPress={() => router.navigate("/(tabs)/alerts")} scaleTo={0.985} style={styles.alert} accessibilityRole="button">
                        <View style={[styles.alertIcon, { backgroundColor: softTint(meta.color, meta.soft) }]}>
                          <Ionicons name={meta.icon} size={18} color={ink(meta.color)} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[styles.alertTitle, !e.acknowledgedAt && styles.alertUnread]} numberOfLines={1}>{alertTitle(e)}</Text>
                          <Text style={styles.alertTime}>{timeAgo(e.occurredAt, now)}</Text>
                        </View>
                        {!e.acknowledgedAt ? <View style={styles.unreadDot} /> : null}
                      </PressableScale>
                    </View>
                  );
                })
              )}
            </Card>
          </FadeInUp>
        </View>
      </ScrollView>
      <Welcome />
    </View>
  );
}

/** Bar colours on the blue header: brighter than the usual status colours so they read on dark blue. */
const BAR = { moving: "#4ade80", idle: "#fbbf24", stopped: "#7dd3fc", offline: "#cbd5e1" } as const;

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <PressableScale onPress={onAction} style={styles.sectionAction} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { paddingBottom: space.xl },
  hero: { paddingHorizontal: space.lg, paddingBottom: space.xl + 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logoChip: { backgroundColor: "#ffffff", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, ...elevation.sm },
  logo: { width: 82, height: 40 },
  liveChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  liveText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  hello: { color: "#d5defa", fontSize: font.body, fontWeight: "500", marginTop: space.lg },
  totalLine: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: 2 },
  total: { color: "#ffffff", fontSize: 44, fontWeight: "800", fontVariant: ["tabular-nums"] },
  totalLabel: { color: "#ffffff", fontSize: font.body, fontWeight: "500" },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 2, marginTop: space.md },
  barPart: { height: 8, borderRadius: 4 },
  // The first row of tiles overlaps the header's rounded bottom edge.
  body: { paddingHorizontal: space.lg, gap: space.lg, marginTop: -20 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.background, borderRadius: 16, padding: space.lg, gap: space.sm, ...elevation.md },
  tileHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tileLabel: { fontSize: font.small, fontWeight: "600", color: colors.mutedForeground },
  tileCount: { fontSize: 30, fontWeight: "800", color: colors.foreground, fontVariant: ["tabular-nums"] },
  mapButton: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.primarySoft, borderRadius: 16, padding: space.lg },
  mapIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  mapTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  mapNote: { fontSize: font.small, color: colors.mutedForeground, marginTop: 1 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.foreground },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
  sectionActionText: { fontSize: font.small, fontWeight: "600", color: colors.primary },
  listCard: { padding: 0, overflow: "hidden" },
  pad: { padding: space.lg },
  quiet: { padding: space.lg, fontSize: font.body, color: colors.mutedForeground },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: ROW_INSET },
  alert: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 62 },
  alertIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: font.body, color: colors.foreground },
  alertUnread: { fontWeight: "700" },
  alertTime: { fontSize: font.small, color: colors.mutedForeground, marginTop: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }
});
