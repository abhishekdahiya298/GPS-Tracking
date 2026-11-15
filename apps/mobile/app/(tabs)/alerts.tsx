import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAlerts } from "@/alerts/AlertsProvider";
import { SEVERITY_META, alertDetail, alertMeta, alertSeverity, alertTitle, type AlertEvent } from "@/alerts/model";
import { Banner, EmptyState, IconWell, ListSkeleton, ScreenHeader, Segmented } from "@/components/kit";
import { FadeInUp, LoadingBar, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { haptic } from "@/haptics";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { LinearGradient } from "expo-linear-gradient";
import { colors, elevation, font, ink, isDark, radius, size, softTint, space, type } from "@/theme";

export default function AlertsScreen() {
  const { events, unread, unreadOnly, loading, loadingMore, hasMore, error, setUnreadOnly, refresh, loadMore, acknowledge } = useAlerts();
  const { units, orgName } = useFleet();
  const router = useRouter();
  const now = useNow();
  const [pulling, setPulling] = useState(false);
  const [busyId, setBusyId] = useState<number | "all" | null>(null);

  async function onPull() {
    setPulling(true);
    await refresh();
    setPulling(false);
  }

  async function mark(ids: number[] | "all") {
    setBusyId(ids === "all" ? "all" : (ids[0] ?? null));
    const problem = await acknowledge(ids);
    setBusyId(null);
    if (!problem) haptic.success();
    if (problem) Alert.alert("Couldn't mark as read", problem);
  }

  function confirmAll() {
    Alert.alert("Mark all as read?", `${unread} unread alert${unread === 1 ? "" : "s"} will be marked as read for everyone in your organization.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Mark all read", onPress: () => void mark("all") }
    ]);
  }

  const row = ({ item, index }: { item: AlertEvent; index: number }) => {
    const meta = alertMeta(item.type);
    const detail = alertDetail(item, units.fmtSpeed);
    const isUnread = !item.acknowledgedAt;

    const sev = SEVERITY_META[alertSeverity(item.type)];
    const body = (
      <>
        <LinearGradient colors={[colors.background, isDark ? colors.background : sev.soft]} locations={[0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.edge, { backgroundColor: ink(sev.color) }]} />
        <IconWell icon={meta.icon} color={meta.color} soft={meta.soft} />
        <View style={styles.flex}>
          <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={2}>{alertTitle(item)}</Text>
          <View style={styles.tagLine}>
            <View style={[styles.tag, { backgroundColor: softTint(SEVERITY_META[alertSeverity(item.type)].color, SEVERITY_META[alertSeverity(item.type)].soft) }]}>
              <Text style={[styles.tagText, { color: ink(SEVERITY_META[alertSeverity(item.type)].color) }]}>{SEVERITY_META[alertSeverity(item.type)].label}</Text>
            </View>
            <Text style={styles.typeText} numberOfLines={1}>{meta.label}</Text>
          </View>
          <Text style={styles.sub} numberOfLines={2}>
            {detail ? `${detail} · ` : ""}
            {new Date(item.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {item.ruleName ? ` · ${item.ruleName}` : ""}
          </Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.time}>{timeAgo(item.occurredAt, now).replace(" ago", "")}</Text>
          {isUnread ? <View style={styles.unreadDot} /> : null}
        </View>
        {isUnread ? (
          <Pressable onPress={() => void mark([item.id])} disabled={busyId !== null} hitSlop={6} style={styles.read} accessibilityRole="button" accessibilityLabel="Mark as read">
            {busyId === item.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="checkmark-circle-outline" size={24} color={colors.primary} />}
          </Pressable>
        ) : null}
      </>
    );
    return (
      <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 10 : 0} style={styles.card}>
        {/* Every alert opens its own page; from there, "View vehicle" goes to the truck. */}
        <PressableScale onPress={() => router.push({ pathname: "/alert/[id]", params: { id: String(item.id) } })} scaleTo={0.985} style={styles.row} accessibilityRole="button" accessibilityHint="Opens the alert">
          {body}
        </PressableScale>
      </FadeInUp>
    );
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        org={orgName}
        title="Alerts"
        badge={unread > 0 ? `${unread} new` : undefined}
        badgeTone="danger"
        right={
          unread > 0 ? (
            <Pressable onPress={confirmAll} disabled={busyId !== null} hitSlop={8} style={styles.markAll} accessibilityRole="button" accessibilityLabel="Mark all read">
              {busyId === "all" ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.link}>Mark all read</Text>}
            </Pressable>
          ) : null
        }
      >
        <Segmented
          label="Which alerts to show"
          value={unreadOnly}
          onChange={setUnreadOnly}
          options={[
            { value: false, label: "All" },
            { value: true, label: unread > 0 ? `Unread ${unread}` : "Unread" }
          ]}
        />
      </ScreenHeader>
      <LoadingBar active={loading} />

      {error && events.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

      {loading ? (
        <View style={styles.list}>
          <ListSkeleton rows={6} />
        </View>
      ) : error && events.length === 0 ? (
        <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load alerts" note={error}>
          <Button title="Try again" icon="refresh" onPress={() => void refresh()} />
        </EmptyState>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => String(e.id)}
          renderItem={row}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          initialNumToRender={10}
          windowSize={9}
          contentContainerStyle={events.length === 0 ? styles.emptyList : styles.list}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : !hasMore && events.length > 0 ? <Text style={styles.end}>No more alerts</Text> : null}
          ListEmptyComponent={
            unreadOnly ? (
              <EmptyState icon="checkmark-done-circle-outline" tone="brand" title="All caught up" note="Nothing unread." />
            ) : (
              <EmptyState icon="notifications-off-outline" title="No alerts yet" note="Alert rules are set up on the website. Alerts will appear here." />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  markAll: { minHeight: size.controlSm, justifyContent: "center" },
  link: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  list: { paddingTop: space.sm, paddingBottom: space.lg },
  emptyList: { flexGrow: 1 },
  card: { marginHorizontal: space.lg, marginBottom: space.sm, borderRadius: radius.xl + 2, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...elevation.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.lg, paddingRight: space.md, paddingVertical: space.md, minHeight: 80, borderRadius: radius.xl + 2, overflow: "hidden" },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  title: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  titleUnread: { fontWeight: "700" },
  sub: { ...type.small, marginTop: 1 },
  tagLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  tag: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  typeText: { ...type.caption, flexShrink: 1 },
  side: { alignItems: "flex-end", gap: 6 },
  time: { ...type.caption, fontVariant: ["tabular-nums"] },
  read: { width: 36, height: size.controlSm, marginRight: -space.sm, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  footer: { padding: space.lg },
  end: { ...type.small, textAlign: "center", padding: space.lg }
});
