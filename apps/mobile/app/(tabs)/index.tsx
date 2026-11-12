import { Ionicons } from "@expo/vector-icons";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertMeta, alertTitle } from "@/alerts/model";
import { useSession } from "@/auth/SessionProvider";
import { GradientCard } from "@/components/Icon3D";
import { Banner, Card, IconWell, type IconName } from "@/components/kit";
import { CountText, FadeInUp, LoadingBar, PressableScale, PulseDot, Skeleton } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { CARD_HEIGHT, VehicleCard } from "@/fleet/VehicleRow";
import { firstName, fleetSummary, greeting, onTheMove, type SummaryKey } from "@/home/model";
import { Welcome } from "@/home/Welcome";
import { colors, elevation, font, isDark, size, space, themed, type, type ToneName } from "@/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const MAP_LIGHT = require("../../assets/map-preview.png");
const MAP_DARK = require("../../assets/map-preview-dark.png");
/* eslint-enable @typescript-eslint/no-require-imports */

// The live map is native code that Expo Go does not contain (see app/map.tsx).
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const MiniMap = inExpoGo ? null : lazy(() => import("@/map/MiniMap"));

const TILE_ICON: Record<SummaryKey, IconName> = { moving: "navigate", idle: "pause", stopped: "stop", offline: "cloud-offline" };
const TILE_TONE: Record<SummaryKey, ToneName> = { moving: "green", idle: "amber", stopped: "blue", offline: "red" };

/** Home: the fleet at a glance. A colourful summary, the live map with every vehicle, who is on the move, and the latest alerts. */
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
  const moving = useMemo(() => onTheMove(devices, 3), [devices]);
  const latest = events.slice(0, 3);
  const name = firstName(user?.name);
  const live = connection === "live";
  const movingCount = summary.parts.find((p) => p.key === "moving")?.count ?? 0;

  async function onPull() {
    setPulling(true);
    await Promise.all([refresh(), refreshAlerts()]);
    setPulling(false);
  }

  const openMap = useCallback((deviceId?: string) => router.navigate(deviceId ? { pathname: "/map", params: { device: deviceId } } : "/map"), [router]);
  const openVehicle = useCallback((deviceId: string) => openMap(deviceId), [openMap]);
  const preview = <Image source={isDark ? MAP_DARK : MAP_LIGHT} style={styles.mapImage} resizeMode="cover" />;

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
        <PressableScale onPress={() => router.navigate("/(tabs)/alerts")} scaleTo={0.92} style={styles.bell} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}>
          <Ionicons name="notifications" size={22} color={colors.primary} />
          {unread > 0 ? <View style={styles.bellDot} /> : null}
        </PressableScale>
      </View>
      <LoadingBar active={loading} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}>
        {error && devices.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

        {/* The headline, on a blue card: greeting, how many are on the road, and the share of each status. */}
        <FadeInUp index={0}>
          <GradientCard tone={{ from: "#3b82f6", to: "#1e3a8a", glow: "#1d4ed8" }} style={styles.hero}>
            <View style={styles.heroBody}>
              <View style={styles.helloLine}>
                <Text style={styles.heroHello} numberOfLines={1}>
                  {greeting(new Date(now).getHours())}
                  {name ? `, ${name}` : ""}
                </Text>
                <View style={styles.live}>
                  <PulseDot size={7} color={live ? "#86efac" : "#fde68a"} live={live} />
                  <Text style={styles.liveText}>{live ? "Live" : error ? "Offline" : "Updating"}</Text>
                </View>
              </View>
              {loading ? (
                <Skeleton width="62%" height={26} style={styles.headlineSkeleton} />
              ) : (
                <Text style={styles.heroTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
                  {summary.total === 0 ? "No vehicles yet" : `${movingCount} of ${summary.total} on the road`}
                </Text>
              )}
              <View style={styles.shareBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {summary.total === 0 ? <View style={[styles.share, styles.shareEmpty]} /> : summary.parts.filter((p) => p.count > 0).map((p) => <View key={p.key} style={[styles.share, { flex: p.count, backgroundColor: SHARE_COLOR[p.key] }]} />)}
              </View>
            </View>
          </GradientCard>
        </FadeInUp>

        {/* Four colourful status tiles. Each opens the vehicle list with that filter. */}
        <FadeInUp index={1} style={styles.tiles}>
          {summary.parts.map((p) => (
            <PressableScale
              key={p.key}
              onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: p.key } })}
              outerStyle={styles.tileSlot}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel={`${p.count} ${p.label}. Show them.`}
            >
              <GradientCard tone={TILE_TONE[p.key]} style={styles.tile}>
                <View style={styles.tileBody}>
                  <View style={styles.tileTop}>
                    <View style={styles.tileIcon}>
                      <Ionicons name={TILE_ICON[p.key]} size={18} color="#ffffff" />
                    </View>
                    {loading ? <Skeleton width={30} height={26} /> : <CountText value={p.count} style={styles.tileCount} />}
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={1}>{p.label}</Text>
                </View>
              </GradientCard>
            </PressableScale>
          ))}
        </FadeInUp>

        {/* The live map with every vehicle on it. The whole card opens the Map tab. */}
        <FadeInUp index={2}>
          <SectionHead title="Live map" />
          <PressableScale onPress={() => openMap()} feedback="press" scaleTo={0.985} style={styles.mapCard} accessibilityRole="button" accessibilityLabel="Open the live map">
            {MiniMap && !loading ? <Suspense fallback={preview}><MiniMap devices={devices} /></Suspense> : preview}
            <View style={styles.mapChip}>
              <PulseDot size={7} color={live ? colors.success : colors.warning} live={live} />
              <Text style={styles.mapChipText}>{loading ? "Loading vehicles" : movingCount > 0 ? `${movingCount} moving now` : `${summary.total} vehicle${summary.total === 1 ? "" : "s"}`}</Text>
            </View>
            <View style={styles.mapExpand}>
              <Ionicons name="expand" size={18} color={colors.foreground} />
            </View>
          </PressableScale>
        </FadeInUp>

        <FadeInUp index={3}>
          <SectionHead title="On the move" action={moving.length > 0 ? "See all" : undefined} onAction={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: "moving" } })} />
          {loading ? (
            <View style={styles.cards}>
              {[0, 1].map((i) => (
                <View key={i} style={styles.skeletonCard}>
                  <Skeleton width={48} height={48} round={14} />
                  <View style={styles.skeletonText}>
                    <Skeleton width="50%" height={14} />
                    <Skeleton width="36%" height={11} />
                  </View>
                </View>
              ))}
            </View>
          ) : moving.length === 0 ? (
            <Card style={styles.listCard}>
              <Text style={styles.quiet}>No vehicle is moving right now.</Text>
            </Card>
          ) : (
            <View style={styles.cards}>
              {moving.map((d) => (
                <VehicleCard key={d.deviceId} device={d} fmtSpeed={units.fmtSpeed} now={now} onPress={openVehicle} />
              ))}
            </View>
          )}
        </FadeInUp>

        <FadeInUp index={4}>
          <SectionHead title="Latest alerts" action={latest.length > 0 ? "See all" : undefined} onAction={() => router.navigate("/(tabs)/alerts")} />
          <Card style={styles.listCard}>
            {latest.length === 0 ? (
              <Text style={styles.quiet}>No alerts yet. Alert rules are set up on the website.</Text>
            ) : (
              latest.map((e, i) => {
                const meta = alertMeta(e.type);
                return (
                  <View key={e.id}>
                    {i > 0 ? <View style={styles.line} /> : null}
                    <PressableScale onPress={() => router.navigate("/(tabs)/alerts")} scaleTo={0.985} style={styles.alert} accessibilityRole="button">
                      <IconWell icon={meta.icon} color={meta.color} />
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
      </ScrollView>
      <Welcome />
    </View>
  );
}

/** The pieces of the bar on the blue card. Light colours, so they read on blue. */
const SHARE_COLOR: Record<SummaryKey, string> = { moving: "#4ade80", idle: "#fbbf24", stopped: "#7dd3fc", offline: "#cbd5e1" };

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

const styles = themed(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingBottom: space.sm },
  logo: { width: 66, height: 32 },
  bell: { width: size.controlSm, height: size.controlSm, borderRadius: size.controlSm / 2, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", right: 9, top: 8, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.primarySoft },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.lg },
  hero: { minHeight: 118 },
  heroBody: { padding: space.lg, gap: 6 },
  helloLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  heroHello: { flexShrink: 1, fontSize: font.small, lineHeight: 18, fontWeight: "500", color: "rgba(255,255,255,0.86)" },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)" },
  liveText: { fontSize: font.caption, lineHeight: 16, fontWeight: "700", color: "#ffffff" },
  heroTitle: { fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.3, color: "#ffffff" },
  headlineSkeleton: { marginVertical: 3, opacity: 0.5 },
  shareBar: { flexDirection: "row", gap: 3, height: 8, marginTop: space.sm },
  share: { height: 8, borderRadius: 4 },
  shareEmpty: { flex: 1, backgroundColor: "rgba(255,255,255,0.25)" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tileSlot: { flexBasis: "46%", flexGrow: 1 },
  tile: { height: 92 },
  tileBody: { flex: 1, padding: 14, justifyContent: "space-between" },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.24)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" },
  tileCount: { fontSize: 30, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5, color: "#ffffff", fontVariant: ["tabular-nums"] },
  tileLabel: { fontSize: font.small, lineHeight: 18, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(255,255,255,0.92)" },
  mapCard: { height: 260, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.muted, ...elevation.sm },
  mapImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  mapChip: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: colors.background, ...elevation.md },
  mapChipText: { fontSize: font.caption, lineHeight: 16, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] },
  mapExpand: { position: "absolute", right: 10, top: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", ...elevation.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, paddingHorizontal: 2 },
  sectionAction: { minHeight: 24, justifyContent: "center" },
  sectionActionText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primary },
  cards: { gap: 10 },
  skeletonCard: { flexDirection: "row", alignItems: "center", gap: space.md, height: CARD_HEIGHT, paddingHorizontal: space.lg, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  skeletonText: { flex: 1, gap: space.sm },
  listCard: { padding: 0, overflow: "hidden" },
  quiet: { ...type.body, padding: space.lg, color: colors.mutedForeground },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.md + size.well + space.md },
  alert: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: size.row + 6 },
  alertTitle: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  alertUnread: { fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }
}));
