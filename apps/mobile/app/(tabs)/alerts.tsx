import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAlerts } from "@/alerts/AlertsProvider";
import { alertDetail, alertMeta, alertTitle, type AlertEvent } from "@/alerts/model";
import { Banner, EmptyState, IconWell, ListSkeleton, RowLine, ScreenHeader, Segmented, groupedRow } from "@/components/kit";
import { FadeInUp, LoadingBar, PressableScale } from "@/components/motion";
import { Button } from "@/components/ui";
import { haptic } from "@/haptics";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { timeAgo } from "@/fleet/model";
import { colors, font, size, space, type, themed } from "@/theme";

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

  const last = events.length - 1;
  const row = ({ item, index }: { item: AlertEvent; index: number }) => {
    const meta = alertMeta(item.type);
    const detail = alertDetail(item, units.fmtSpeed);
    const isUnread = !item.acknowledgedAt;
    // An alert about a vehicle we know opens that vehicle; load alerts have no vehicle.
    const known = item.deviceId !== null && devices.some((d) => d.deviceId === item.deviceId);
    const body = (
      <>
        <IconWell icon={meta.icon} color={meta.color} soft={meta.soft} />
        <View style={styles.flex}>
          <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={2}>{alertTitle(item)}</Text>
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
      <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 10 : 0} style={groupedRow(index === 0, index === last)}>
        {known ? (
          <PressableScale onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: item.deviceId! } })} scaleTo={0.985} style={styles.row} accessibilityRole="button" accessibilityHint="Opens the vehicle">
            {body}
          </PressableScale>
        ) : (
          <View style={styles.row}>{body}</View>
        )}
      </FadeInUp>
    );
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
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
          ItemSeparatorComponent={RowLine}
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

const styles = themed(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  markAll: { minHeight: size.controlSm, justifyContent: "center" },
  link: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  list: { paddingTop: space.xs, paddingBottom: space.lg },
  emptyList: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: size.row + 4 },
  title: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  titleUnread: { fontWeight: "700" },
  sub: { ...type.small, marginTop: 1 },
  side: { alignItems: "flex-end", gap: 6 },
  time: { ...type.caption, fontVariant: ["tabular-nums"] },
  read: { width: 36, height: size.controlSm, marginRight: -space.sm, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  footer: { padding: space.lg },
  end: { ...type.small, textAlign: "center", padding: space.lg }
}));
