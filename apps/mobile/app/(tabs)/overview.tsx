import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "@/alerts/AlertsProvider";
import { SEVERITY_META, alertDetail, alertMeta, alertSeverity, alertTitle } from "@/alerts/model";
import { useSession } from "@/auth/SessionProvider";
import { Banner, Card, IconWell, type IconName } from "@/components/kit";
import { CountText, FadeInUp, LoadingBar, PressableScale, PulseDot, Skeleton } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { STATE_META, displayName, timeAgo } from "@/fleet/model";
import { VehicleRow } from "@/fleet/VehicleRow";
import { MiniFleetMap } from "@/map/MiniFleetMap";
import { firstName, fleetSummary, greeting, needsAttention, onTheMove, type SummaryKey } from "@/home/model";
import { Welcome } from "@/home/Welcome";
import { colors, elevation, font, ink, isDark, radius, size, softTint, space, themed, type } from "@/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const MAP_PREVIEW_LIGHT = require("../../assets/map-preview.png");
const MAP_PREVIEW_DARK = require("../../assets/map-preview-dark.png");
/* eslint-enable @typescript-eslint/no-require-imports */

/** Each status tile shows the same shape as the status badges: play, pause, square, no signal. */
const TILE_ICON: Record<SummaryKey, IconName> = { moving: "play", idle: "pause", stopped: "square", offline: "cloud-offline-outline" };

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
    const moving = onTheMove(devices, 2);
    if (moving.length >= 2) return moving;
    const rest = devices.filter((d) => !moving.includes(d) && d.location).sort((a, b) => (b.location?.recordedAt ?? "").localeCompare(a.location?.recordedAt ?? ""));
    return [...moving, ...rest].slice(0, 2);
  }, [devices]);
  const attention = useMemo(() => needsAttention(devices, displayName), [devices]);
  const latest = events.slice(0, 2);
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
          <View style={styles.flex}>
            <Text style={styles.helloTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {greeting(new Date(now).getHours())}
              {name ? `, ${name}` : ""}
            </Text>
            <Text style={type.small}>{loading ? "Loading your fleet…" : summary.total === 0 ? "No vehicles yet" : `${movingCount} of ${summary.total} on the road`}</Text>
          </View>
          <View style={[styles.livePill, { backgroundColor: softTint(live ? STATE_META.moving.color : STATE_META.idle.color, live ? STATE_META.moving.soft : STATE_META.idle.soft) }]}>
            <PulseDot size={7} color={ink(live ? STATE_META.moving.color : STATE_META.idle.color)} live={live} />
            <Text style={[styles.livePillText, { color: ink(live ? STATE_META.moving.color : STATE_META.idle.color) }]}>{live ? "Live" : error ? "Offline" : "Updating"}</Text>
          </View>
        </FadeInUp>

        {/* One card: the fleet on a live map, then the share of each status and a tile per status. */}
        <FadeInUp index={1} style={styles.fleetCard}>
          <PressableScale onPress={() => openMap()} feedback="press" scaleTo={0.99} style={styles.mapArea} accessibilityRole="button" accessibilityLabel="Open the live map">
            {loading ? <Image source={(isDark ? MAP_PREVIEW_DARK : MAP_PREVIEW_LIGHT)} style={styles.mapImage} resizeMode="cover" /> : <MiniFleetMap devices={devices} />}
            <View style={styles.mapChip}>
              <Ionicons name="bus-outline" size={15} color={colors.foreground} />
              <Text style={styles.mapChipText}>{loading ? "Your fleet" : `${summary.total} vehicle${summary.total === 1 ? "" : "s"}`}</Text>
            </View>
            <View style={styles.mapOpen}>
              <Text style={styles.mapOpenText}>Open map</Text>
              <Ionicons name="arrow-forward" size={15} color="#ffffff" />
            </View>
          </PressableScale>
          <View style={styles.statArea}>
            {summary.total > 0 ? (
              <View style={styles.shareBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {summary.parts.filter((p) => p.count > 0).map((p) => <View key={p.key} style={{ flex: p.count, backgroundColor: ink(p.color) }} />)}
              </View>
            ) : null}
            <View style={styles.tileRow}>
              {summary.parts.map((p) => (
                <PressableScale
                  key={p.key}
                  onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: p.key } })}
                  outerStyle={styles.tileSlot}
                  style={[styles.tile, { backgroundColor: softTint(p.color, STATE_META[p.key].soft) }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.count} ${p.label}. Show them.`}
                >
                  <View style={styles.tileTop}>
                    <Ionicons name={TILE_ICON[p.key]} size={p.key === "stopped" ? 10 : 12} color={ink(p.color)} />
                    {loading ? <Skeleton width={22} height={20} style={styles.countSkeleton} /> : <CountText value={p.count} style={[styles.tileValue, { color: ink(p.color) }]} />}
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{p.label}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
        </FadeInUp>

        {attention.length > 0 ? (
          <FadeInUp index={2}>
            <SectionHead title="Needs attention" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.needRow}>
              {attention.map((item) => {
                const meta = item.key === "offline" ? STATE_META.offline : STATE_META.idle;
                return (
                  <PressableScale key={item.key} onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: "offline" } })} scaleTo={0.97} style={styles.needCard} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.detail}`}>
                    {isDark ? null : <LinearGradient colors={[colors.background, meta.soft]} locations={[0.35, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
                    <View style={[styles.edge, { backgroundColor: ink(meta.color) }]} />
                    <View style={styles.needTop}>
                      <IconWell icon={item.key === "offline" ? "cloud-offline-outline" : "hourglass-outline"} color={meta.color} soft={meta.soft} box={34} />
                      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={type.small} numberOfLines={1}>{item.detail}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </FadeInUp>
        ) : null}

        <FadeInUp index={3}>
          <SectionHead title="Recent alerts" action={latest.length > 0 ? "View all" : undefined} onAction={() => router.navigate("/(tabs)/alerts")} />
          {latest.length === 0 ? (
            <Card>
              <Text style={styles.quietInCard}>No alerts yet. Alert rules are set up on the website.</Text>
            </Card>
          ) : (
            <View style={styles.stack}>
              {latest.map((e) => {
                const meta = alertMeta(e.type);
                const sev = SEVERITY_META[alertSeverity(e.type)];
                const detail = alertDetail(e, units.fmtSpeed);
                return (
                  <PressableScale key={e.id} onPress={() => router.push({ pathname: "/alert/[id]", params: { id: String(e.id) } })} scaleTo={0.985} style={styles.alertCard} accessibilityRole="button">
                    {isDark ? null : <LinearGradient colors={[colors.background, sev.soft]} locations={[0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
                    <View style={[styles.edge, { backgroundColor: ink(sev.color) }]} />
                    <IconWell icon={meta.icon} color={meta.color} soft={meta.soft} box={40} />
                    <View style={styles.flex}>
                      <View style={styles.alertHead}>
                        <Text style={[styles.cardTitle, styles.shrink, !e.acknowledgedAt && styles.unreadTitle]} numberOfLines={1}>{alertTitle(e)}</Text>
                        <View style={[styles.sevTag, { backgroundColor: softTint(sev.color, sev.soft) }]}>
                          <Text style={[styles.sevText, { color: ink(sev.color) }]}>{sev.label}</Text>
                        </View>
                      </View>
                      <Text style={type.small} numberOfLines={1}>{detail || meta.label}</Text>
                    </View>
                    <View style={styles.alertSide}>
                      <Text style={styles.alertTime}>{timeAgo(e.occurredAt, now).replace(" ago", "")}</Text>
                      {!e.acknowledgedAt ? <View style={styles.unreadDot} /> : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          )}
        </FadeInUp>
        <FadeInUp index={4}>
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

const styles = themed(() => ({
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
  hello: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
  helloTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.4, color: colors.foreground },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 13, marginBottom: 2 },
  livePillText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  fleetCard: { borderRadius: radius.xl + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", ...elevation.md },
  mapArea: { height: 232, backgroundColor: colors.muted, overflow: "hidden" },
  statArea: { padding: 10, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  shareBar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 },
  tileRow: { flexDirection: "row", gap: 6 },
  tileSlot: { flex: 1 },
  tile: { alignItems: "center", gap: 1, paddingVertical: 7, paddingHorizontal: 2, borderRadius: radius.lg },
  tileTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  tileLabel: { fontSize: 12, lineHeight: 15, fontWeight: "600", color: colors.foreground },
  tileValue: { fontSize: 20, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  bleed: { marginHorizontal: -space.lg },
  needRow: { paddingHorizontal: space.lg, gap: space.sm },
  needCard: { width: 214, gap: 6, paddingVertical: space.md, paddingLeft: 15, paddingRight: space.md, borderRadius: radius.xl + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", ...elevation.sm },
  needTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  stack: { gap: space.sm },
  alertCard: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 70, paddingVertical: 10, paddingLeft: 15, paddingRight: space.md, borderRadius: radius.xl + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", ...elevation.sm },
  alertHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  shrink: { flexShrink: 1 },
  cardTitle: { fontSize: font.body, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  unreadTitle: { fontWeight: "800" },
  sevTag: { paddingHorizontal: 6, borderRadius: 5 },
  sevText: { fontSize: 11, lineHeight: 17, fontWeight: "700" },
  alertSide: { alignItems: "flex-end", gap: 8 },
  alertTime: { ...type.caption, fontWeight: "600", fontVariant: ["tabular-nums"] },
  quietInCard: { ...type.body, color: colors.mutedForeground },
  cardSkeleton: { marginHorizontal: space.lg, marginBottom: 10 },
  countSkeleton: { marginVertical: 2 },
  mapImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  mapChip: { position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: colors.background, ...elevation.md },
  mapChipText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  mapOpen: { position: "absolute", right: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 4, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.primary, ...elevation.md },
  mapOpenText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: "#ffffff" },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, paddingHorizontal: 2 },
  sectionAction: { minHeight: 24, justifyContent: "center" },
  sectionActionText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primary },
  quiet: { ...type.body, padding: space.lg, color: colors.mutedForeground },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }
}));
