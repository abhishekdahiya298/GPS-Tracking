import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertDetail, alertMeta, alertTitle, type AlertEvent } from "@/alerts/model";
import { Banner, EmptyState, ListSkeleton } from "@/components/kit";
import { FadeInUp, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { haptic } from "@/haptics";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { colors, font, radius, space, ink, isDark, softTint } from "@/theme";

export default function AlertsScreen() {
  const { events, unread, unreadOnly, loading, loadingMore, hasMore, error, setUnreadOnly, refresh, loadMore, acknowledge } = useAlerts();
  const { units, devices } = useFleet();
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
    // An alert about a vehicle we know opens that vehicle; load alerts have no vehicle.
    const known = item.deviceId !== null && devices.some((d) => d.deviceId === item.deviceId);
    const body = (
      <>
        <View style={[styles.icon, { backgroundColor: softTint(meta.color, meta.soft) }]}>
          <Ionicons name={meta.icon} size={20} color={ink(meta.color)} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.title, isUnread && styles.titleUnread]}>{alertTitle(item)}</Text>
          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          <Text style={styles.sub}>
            {timeAgo(item.occurredAt, now)} · {new Date(item.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {item.ruleName ? ` · ${item.ruleName}` : ""}
          </Text>
        </View>
        {isUnread ? (
          <Pressable onPress={() => void mark([item.id])} disabled={busyId !== null} hitSlop={8} style={styles.read} accessibilityRole="button" accessibilityLabel="Mark as read">
            {busyId === item.id ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="checkmark-circle-outline" size={26} color={colors.primary} />}
          </Pressable>
        ) : null}
      </>
    );
    return (
      <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 12 : 0}>
        {known ? (
          <PressableScale
            onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: item.deviceId! } })}
            scaleTo={0.985}
            style={[styles.row, isUnread && styles.rowUnread]}
            accessibilityRole="button"
            accessibilityHint="Opens the vehicle"
          >
            {isUnread ? <View style={styles.unreadBar} /> : null}
            {body}
          </PressableScale>
        ) : (
          <View style={[styles.row, isUnread && styles.rowUnread]}>
            {isUnread ? <View style={styles.unreadBar} /> : null}
            {body}
          </View>
        )}
      </FadeInUp>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={styles.segment}>
          {[false, true].map((only) => {
            const on = unreadOnly === only;
            return (
              <Pressable
                key={String(only)}
                onPress={() => {
                  haptic.tap();
                  setUnreadOnly(only);
                }}
                style={[styles.segmentItem, on && styles.segmentOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{only ? `Unread ${unread}` : "All"}</Text>
              </Pressable>
            );
          })}
        </View>
        {unread > 0 ? (
          <Pressable onPress={confirmAll} disabled={busyId !== null} hitSlop={8} accessibilityRole="button">
            {busyId === "all" ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.link}>Mark all read</Text>}
          </Pressable>
        ) : null}
      </View>

      {error && events.length > 0 ? <Banner text={`Showing the last update. ${error}`} /> : null}

      {loading ? (
        <ListSkeleton />
      ) : error && events.length === 0 ? (
        <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load alerts" note={error}>
          <Button title="Try again" icon="refresh" onPress={() => void refresh()} />
        </EmptyState>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => String(e.id)}
          renderItem={row}
          ItemSeparatorComponent={() => <View style={styles.line} />}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          contentContainerStyle={events.length === 0 ? styles.emptyList : undefined}
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
  wrap: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  segment: { flexDirection: "row", backgroundColor: colors.muted, borderRadius: radius.xl, padding: 3 },
  segmentItem: { paddingHorizontal: space.lg, minHeight: 34, justifyContent: "center", borderRadius: radius.lg },
  segmentOn: { backgroundColor: colors.background, shadowColor: "#101828", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontSize: font.small, fontWeight: "500", color: colors.mutedForeground },
  segmentTextOn: { color: colors.foreground, fontWeight: "600" },
  link: { color: colors.primary, fontSize: font.small, fontWeight: "600" },
  emptyList: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowUnread: { backgroundColor: isDark ? "#18223a" : "#f4f7ff" },
  unreadBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.primary },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { fontSize: font.body, color: colors.foreground, lineHeight: 20 },
  titleUnread: { fontWeight: "600" },
  detail: { fontSize: font.small, color: colors.foreground, marginTop: 2 },
  sub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2 },
  read: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -space.sm },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  footer: { padding: space.lg },
  end: { textAlign: "center", color: colors.mutedForeground, fontSize: font.small, padding: space.lg }
});
