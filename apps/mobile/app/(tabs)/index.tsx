import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertMeta, alertTitle } from "@/alerts/model";
import { useSession } from "@/auth/SessionProvider";
import { Banner, Card, IconWell, type IconName } from "@/components/kit";
import { CountText, FadeInUp, LoadingBar, PressableScale, PulseDot, Skeleton } from "@/components/motion";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { ROW_HEIGHT, ROW_INSET, VehicleRow } from "@/fleet/VehicleRow";
import { firstName, fleetSummary, greeting, onTheMove, type SummaryKey } from "@/home/model";
import { Welcome } from "@/home/Welcome";
import { colors, elevation, font, isDark, radius, size, space, type } from "@/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const MAP_PREVIEW = isDark ? require("../../assets/map-preview-dark.png") : require("../../assets/map-preview.png");
/* eslint-enable @typescript-eslint/no-require-imports */

const TILE_ICON: Record<SummaryKey, IconName> = { moving: "navigate-outline", idle: "pause-circle-outline", stopped: "stop-circle-outline", offline: "cloud-offline-outline" };
const TILE_SOFT: Record<SummaryKey, string> = { moving: "#e9f7ee", idle: "#fff5e1", stopped: "#e8f4fb", offline: "#f3f4f6" };

/** Home: the fleet at a glance. Status counts, the way into the map, who is on the move, and the latest alerts. */
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

  const openMap = useCallback((deviceId?: string) => router.navigate(deviceId ? { pathname: "/(tabs)/map", params: { device: deviceId } } : "/(tabs)/map"), [router]);
  const openVehicle = useCallback((deviceId: string) => openMap(deviceId), [openMap]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
        <PressableScale onPress={() => router.navigate("/(tabs)/alerts")} scaleTo={0.92} style={styles.bell} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}>
          <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
          {unread > 0 ? <View style={styles.bellDot} /> : null}
        </PressableScale>
      </View>
      <LoadingBar active={loading} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}>
        {error && devices.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

        <FadeInUp index={0} style={styles.hello}>
          <View style={styles.helloLine}>
            <Text style={type.small}>
              {greeting(new Date(now).getHours())}
              {name ? `, ${name}` : ""}
            </Text>
            <View style={styles.live}>
              <PulseDot size={7} color={live ? colors.success : colors.warning} live={live} />
              <Text style={[styles.liveText, { color: live ? colors.success : colors.warning }]}>{live ? "Live" : error ? "Offline" : "Updating"}</Text>
            </View>
          </View>
          {loading ? (
            <Skeleton width="62%" height={24} style={styles.headlineSkeleton} />
          ) : (
            <Text style={type.largeTitle} accessibilityRole="header">
              {summary.total === 0 ? "No vehicles yet" : `${movingCount} of ${summary.total} on the road`}
            </Text>
          )}
        </FadeInUp>

        {/* Four status tiles. Each opens the vehicle list with that filter. */}
        <FadeInUp index={1} style={styles.tiles}>
          {summary.parts.map((p) => (
            <PressableScale
              key={p.key}
              onPress={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: p.key } })}
              outerStyle={styles.tileSlot}
              style={styles.tile}
              accessibilityRole="button"
              accessibilityLabel={`${p.count} ${p.label}. Show them.`}
            >
              <IconWell icon={TILE_ICON[p.key]} color={p.color} soft={TILE_SOFT[p.key]} />
              <View>
                {loading ? <Skeleton width={28} height={22} style={styles.countSkeleton} /> : <CountText value={p.count} style={type.metric} />}
                <Text style={type.small}>{p.label}</Text>
              </View>
            </PressableScale>
          ))}
        </FadeInUp>

        {/* The way into the live map. A drawn picture, not a second live map: it costs nothing to show. */}
        <FadeInUp index={2}>
          <PressableScale onPress={() => openMap()} feedback="press" scaleTo={0.985} style={styles.mapCard} accessibilityRole="button" accessibilityLabel="Open the live map">
            <Image source={MAP_PREVIEW} style={styles.mapImage} resizeMode="cover" />
            <View style={styles.mapChip}>
              <PulseDot size={7} color={live ? colors.success : colors.warning} live={live} />
              <Text style={styles.mapChipText}>{loading ? "Live map" : movingCount > 0 ? `${movingCount} moving now` : "Live map"}</Text>
            </View>
            <View style={styles.mapOpen}>
              <Text style={styles.mapOpenText}>Open map</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primaryForeground} />
            </View>
          </PressableScale>
        </FadeInUp>

        <FadeInUp index={3}>
          <SectionHead title="On the move" action={moving.length > 0 ? "See all" : undefined} onAction={() => router.navigate({ pathname: "/(tabs)/vehicles", params: { filter: "moving" } })} />
          <Card style={styles.listCard}>
            {loading ? (
              [0, 1].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <Skeleton width={size.well} height={size.well} round={radius.lg} />
                  <View style={styles.skeletonText}>
                    <Skeleton width="50%" height={14} />
                    <Skeleton width="36%" height={11} />
                  </View>
                </View>
              ))
            ) : moving.length === 0 ? (
              <Text style={styles.quiet}>No vehicle is moving right now.</Text>
            ) : (
              moving.map((d, i) => (
                <View key={d.deviceId}>
                  {i > 0 ? <View style={styles.line} /> : null}
                  <VehicleRow device={d} fmtSpeed={units.fmtSpeed} now={now} onPress={openVehicle} />
                </View>
              ))
            )}
          </Card>
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
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingBottom: space.sm },
  logo: { width: 66, height: 32 },
  bell: { width: size.controlSm, height: size.controlSm, borderRadius: size.controlSm / 2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", right: 10, top: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.background },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.lg },
  hello: { gap: 2 },
  helloLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  live: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveText: { fontSize: font.caption, lineHeight: 16, fontWeight: "600" },
  headlineSkeleton: { marginVertical: 3 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileSlot: { flexBasis: "47%", flexGrow: 1 },
  tile: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: space.md },
  countSkeleton: { marginVertical: 2 },
  mapCard: { height: 168, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.muted },
  mapImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  mapChip: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.background, ...elevation.sm },
  mapChipText: { fontSize: font.caption, lineHeight: 16, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  mapOpen: { position: "absolute", right: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.primary, ...elevation.md },
  mapOpenText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primaryForeground },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, paddingHorizontal: 2 },
  sectionAction: { minHeight: 24, justifyContent: "center" },
  sectionActionText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primary },
  listCard: { padding: 0, overflow: "hidden" },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: ROW_HEIGHT },
  skeletonText: { flex: 1, gap: space.sm },
  quiet: { ...type.body, padding: space.lg, color: colors.mutedForeground },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: ROW_INSET },
  alert: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: ROW_HEIGHT },
  alertTitle: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  alertUnread: { fontWeight: "700" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }
});
