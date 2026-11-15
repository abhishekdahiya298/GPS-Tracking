import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertMeta, alertTitle } from "@/alerts/model";
import { useSession } from "@/auth/SessionProvider";
import { Banner, Card, IconWell, type IconName } from "@/components/kit";
import { CountText, FadeInUp, LoadingBar, PressableScale, PulseDot, Skeleton } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, displayName, timeAgo } from "@/fleet/model";
import { VehicleRow } from "@/fleet/VehicleRow";
import { MiniFleetMap } from "@/map/MiniFleetMap";
import { firstName, fleetSummary, greeting, needsAttention, onTheMove, type SummaryKey } from "@/home/model";
import { Welcome } from "@/home/Welcome";
import { colors, elevation, font, isDark, radius, size, space, type } from "@/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const MAP_PREVIEW = isDark ? require("../../assets/map-preview-dark.png") : require("../../assets/map-preview.png");
/* eslint-enable @typescript-eslint/no-require-imports */

/** Each status tile shows the same shape as the status badges: play, pause, square, no signal. */
const TILE_ICON: Record<SummaryKey, IconName> = { moving: "play", idle: "pause", stopped: "square", offline: "cloud-offline-outline" };
const ROW = 64;

/** Home: the fleet at a glance. Status counts, the way into the map, who is on the move, and the latest alerts. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useSession();
  const { devices, loading, error, connection, units, orgName, refresh } = useFleet();
  const { events, unread, refresh: refreshAlerts } = useAlerts();
  const now = useNow();
  const [pulling, setPulling] = useState(false);

  const user = state.status === "signedIn" ? state.user : null;
  const summary = useMemo(() => fleetSummary(devices), [devices]);
  // Who to show under "Latest vehicle activity": the moving ones first, then the freshest reports.
  const activity = useMemo(() => {
    const moving = onTheMove(devices, 3);
    if (moving.length >= 3) return moving;
    const rest = devices.filter((d) => !moving.includes(d) && d.location).sort((a, b) => (b.location?.recordedAt ?? "").localeCompare(a.location?.recordedAt ?? ""));
    return [...moving, ...rest].slice(0, 3);
  }, [devices]);
  const attention = useMemo(() => needsAttention(devices, displayName), [devices]);
  const latest = events.slice(0, 3);
  const name = firstName(user?.name);
  const live = connection === "live";
  const movingCount = summary.parts.find((p) => p.key === "moving")?.count ?? 0;

  async function onPull() {
    setPulling(true);
    await Promise.all([refresh(), refreshAlerts()]);
    setPulling(false);
  }

  const openMap = useCallback((deviceId?: string) => router.navigate(deviceId ? { pathname: "/(tabs)", params: { device: deviceId } } : "/(tabs)"), [router]);
  const openVehicle = useCallback((deviceId: string) => openMap(deviceId), [openMap]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
        {orgName ? <View style={styles.headerRule} /> : null}
        <Text style={styles.org} numberOfLines={1}>{orgName}</Text>
        <PressableScale onPress={() => router.navigate("/(tabs)/alerts")} scaleTo={0.92} style={styles.bell} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}>
          <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
          {unread > 0 ? <View style={styles.bellDot} /> : null}
        </PressableScale>
      </View>
      <LoadingBar active={loading} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}>
        {error && devices.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

        <FadeInUp index={0} style={styles.hello}>
          <Text style={type.largeTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {greeting(new Date(now).getHours())}
            {name ? `, ${name}` : ""}
          </Text>
          <View style={styles.helloLine}>
            <PulseDot size={7} color={live ? colors.success : colors.warning} live={live} />
            <Text style={type.small}>
              {loading ? "Loading your fleet…" : summary.total === 0 ? "No vehicles yet" : `${movingCount} of ${summary.total} on the road`} · {live ? "Live" : error ? "Offline" : "Updating"}
            </Text>
          </View>
        </FadeInUp>

        {/* The fleet total on navy, then one tinted tile per status. Each opens the vehicle list with that filter. */}
        <FadeInUp index={1} style={styles.tiles}>
          {/* The fleet total on a navy band, then one tile per status in a single row. Each opens the list with that filter. */}
          <PressableScale onPress={() => router.navigate("/(tabs)/vehicles")} style={styles.total} accessibilityRole="button" accessibilityLabel={`${summary.total} vehicles, ${movingCount} on the road. Show them.`}>
            <LinearGradient colors={["#1a3a8f", "#0f1f4d"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={styles.totalWave} />
            <View style={styles.totalIcon}>
              <Ionicons name="bus-outline" size={24} color="#ffffff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.totalLabel}>Total vehicles</Text>
              <Text style={styles.totalSub}>{loading ? "Loading…" : `${movingCount} on the road now`}</Text>
            </View>
            {loading ? <Skeleton width={44} height={34} style={styles.countSkeleton} /> : <CountText value={summary.total} style={styles.totalValue} />}
          </PressableScale>
          <View style={styles.tileRow}>
            {summary.parts.map((p) => {
              const soft = STATE_META[p.key].soft;
              return (
                <PressableScale
                  key={p.key}
                  onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: p.key } })}
                  outerStyle={styles.tileSlot}
                  style={[styles.tile, { borderColor: isDark ? colors.border : `${p.color}33` }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.count} ${p.label}. Show them.`}
                >
                  {isDark ? null : <LinearGradient colors={[soft, colors.background]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />}
                  <View style={[styles.tileIcon, { backgroundColor: isDark ? colors.muted : `${p.color}1f` }]}>
                    <Ionicons name={TILE_ICON[p.key]} size={p.key === "stopped" ? 12 : 15} color={p.color} />
                  </View>
                  {loading ? <Skeleton width={24} height={22} style={styles.countSkeleton} /> : <CountText value={p.count} style={styles.tileValue} />}
                  <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{p.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </FadeInUp>

        {/* The way into the live map. A drawn picture, not a second live map: it costs nothing to show. */}
        <FadeInUp index={2}>
          <PressableScale onPress={() => openMap()} feedback="press" scaleTo={0.985} style={styles.mapCard} accessibilityRole="button" accessibilityLabel="Open the live map">
            {loading ? <Image source={MAP_PREVIEW} style={styles.mapImage} resizeMode="cover" /> : <MiniFleetMap devices={devices} />}
            <View style={styles.mapChip}>
              <PulseDot size={7} color={live ? colors.success : colors.warning} live={live} />
              <Text style={styles.mapChipText}>{loading ? "Live fleet" : movingCount > 0 ? `${movingCount} moving now` : "Live fleet"}</Text>
            </View>
            <View style={styles.mapOpen}>
              <Text style={styles.mapOpenText}>View map</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary} />
            </View>
          </PressableScale>
        </FadeInUp>

        {attention.length > 0 ? (
          <FadeInUp index={3}>
            <SectionHead title="Needs attention" />
            <Card style={styles.listCard}>
              {attention.map((item, i) => (
                <View key={item.key}>
                  {i > 0 ? <View style={styles.line} /> : null}
                  <PressableScale onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: "offline" } })} scaleTo={0.985} style={styles.alert} accessibilityRole="button">
                    <IconWell icon={item.key === "offline" ? "cloud-offline-outline" : "hourglass-outline"} color={item.key === "offline" ? STATE_META.offline.color : STATE_META.idle.color} soft={item.key === "offline" ? STATE_META.offline.soft : STATE_META.idle.soft} />
                    <View style={styles.flex}>
                      <Text style={styles.alertTitleBold} numberOfLines={1}>{item.title}</Text>
                      <Text style={type.small} numberOfLines={1}>{item.detail}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                  </PressableScale>
                </View>
              ))}
            </Card>
          </FadeInUp>
        ) : null}

        <FadeInUp index={4}>
          <SectionHead title="Recent alerts" action={latest.length > 0 ? "See all" : undefined} onAction={() => router.navigate("/(tabs)/alerts")} />
          <Card style={styles.listCard}>
            {latest.length === 0 ? (
              <Text style={styles.quiet}>No alerts yet. Alert rules are set up on the website.</Text>
            ) : (
              latest.map((e, i) => {
                const meta = alertMeta(e.type);
                return (
                  <View key={e.id}>
                    {i > 0 ? <View style={styles.line} /> : null}
                    <PressableScale onPress={() => router.push({ pathname: "/alert/[id]", params: { id: String(e.id) } })} scaleTo={0.985} style={styles.alert} accessibilityRole="button">
                      <IconWell icon={meta.icon} color={meta.color} soft={meta.soft} />
                      <View style={styles.flex}>
                        <Text style={[styles.alertTitle, !e.acknowledgedAt && styles.alertUnread]} numberOfLines={1}>{alertTitle(e)}</Text>
                        <Text style={type.small}>{timeAgo(e.occurredAt, now)}</Text>
                      </View>
                      {!e.acknowledgedAt ? <View style={styles.unreadDot} /> : null}
                    </PressableScale>
                  </View>
                );
              })
            )}
          </Card>
        </FadeInUp>
        <FadeInUp index={5}>
          <SectionHead title="Latest vehicle activity" action={activity.length > 0 ? "View all" : undefined} onAction={() => router.navigate("/(tabs)/vehicles")} />
          <View style={styles.cardList}>
            {loading ? (
              [0, 1].map((i) => <Skeleton key={i} width="100%" height={92} round={radius.xl} style={styles.cardSkeleton} />)
            ) : activity.length === 0 ? (
              <Text style={styles.quiet}>No positions yet. Vehicles appear here once their trackers report.</Text>
            ) : (
              activity.map((d) => <VehicleRow key={d.deviceId} device={d} fmtSpeed={units.fmtSpeed} now={now} onPress={openVehicle} />)
            )}
          </View>
        </FadeInUp>
      </ScrollView>
      <Welcome />
    </View>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={type.section} accessibilityRole="header">{title}</Text>
      {action && onAction ? (
        <PressableScale onPress={onAction} hitSlop={8} style={styles.sectionAction} accessibilityRole="button" accessibilityLabel={`${title}: ${action}`}>
          <Text style={styles.sectionActionText}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Vehicle cards bring their own side margins, so this list runs edge to edge.
  cardList: { marginHorizontal: -space.lg },
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  logo: { width: 72, height: 36 },
  headerRule: { width: 1, height: 24, backgroundColor: colors.borderStrong },
  org: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.foreground },
  bell: { width: size.controlSm, height: size.controlSm, borderRadius: size.controlSm / 2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", right: 10, top: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.background },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.lg },
  hello: { gap: 4 },
  helloLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  live: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveText: { fontSize: font.caption, lineHeight: 16, fontWeight: "600" },
  headlineSkeleton: { marginVertical: 3 },
  tiles: { gap: space.sm },
  total: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 84, paddingHorizontal: space.lg, borderRadius: radius.xl + 2, overflow: "hidden", ...elevation.md },
  totalWave: { position: "absolute", right: -40, bottom: -50, width: 220, height: 110, borderRadius: 110, backgroundColor: "#2563eb", opacity: 0.35 },
  totalIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  totalLabel: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: "#ffffff" },
  totalSub: { fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.8)" },
  totalValue: { fontSize: 38, lineHeight: 44, fontWeight: "800", color: "#ffffff", fontVariant: ["tabular-nums"] },
  tileRow: { flexDirection: "row", gap: space.sm },
  tileSlot: { flex: 1 },
  tile: { alignItems: "center", gap: 3, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 4, borderRadius: radius.xl, borderWidth: 1, backgroundColor: colors.background, overflow: "hidden", ...elevation.sm },
  tileIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.mutedForeground },
  tileValue: { fontSize: 22, lineHeight: 26, fontWeight: "800", color: colors.foreground, fontVariant: ["tabular-nums"] },
  cardSkeleton: { marginHorizontal: space.lg, marginBottom: 10 },
  countSkeleton: { marginVertical: 2 },
  mapCard: { height: 168, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.muted },
  mapImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  mapChip: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.background, ...elevation.sm },
  mapChipText: { fontSize: font.caption, lineHeight: 16, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  mapOpen: { position: "absolute", right: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.background, ...elevation.md },
  mapOpenText: { fontSize: 14, lineHeight: 20, fontWeight: "700", color: colors.primary },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, paddingHorizontal: 2 },
  sectionAction: { minHeight: 24, justifyContent: "center" },
  sectionActionText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primary },
  listCard: { padding: 0, overflow: "hidden" },
  quiet: { ...type.body, padding: space.lg, color: colors.mutedForeground },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.md + size.well + space.md },
  alert: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: ROW },
  alertTitleBold: { fontSize: font.body, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  alertTitle: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  alertUnread: { fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }
});
