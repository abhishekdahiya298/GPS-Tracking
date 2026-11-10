import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner, Chip, EmptyState, ListSkeleton, SearchBox, StatusPill, VehicleAvatar } from "@/components/kit";
import { FadeInUp, PressableScale, Skeleton } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, countByFilter, displayName, fleetState, selectDevices, statusLine, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { colors, font, radius, space } from "@/theme";

export default function VehiclesScreen() {
  const router = useRouter();
  const { devices, loading, error, units, refresh } = useFleet();
  const now = useNow();
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [search, setSearch] = useState("");
  const [pulling, setPulling] = useState(false);

  const counts = useMemo(() => countByFilter(devices), [devices]);
  const rows = useMemo(() => selectDevices(devices, filter, search), [devices, filter, search]);

  async function onPull() {
    setPulling(true);
    await refresh();
    setPulling(false);
  }

  if (loading) {
    return (
      <View style={styles.wrap}>
        <View style={styles.top}>
          <Skeleton width="100%" height={46} round={radius.xl} />
        </View>
        <ListSkeleton />
      </View>
    );
  }

  if (error && devices.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load vehicles" note={error}>
          <Button title="Try again" icon="refresh" onPress={() => void refresh()} />
        </EmptyState>
      </View>
    );
  }

  const row = ({ item, index }: { item: FleetDevice; index: number }) => {
    const state = fleetState(item);
    return (
      // Only the first screenful staggers in; rows reached by scrolling appear at once.
      <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 12 : 0}>
        <PressableScale
          onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: item.deviceId } })}
          style={styles.row}
          scaleTo={0.985}
          accessibilityRole="button"
          accessibilityLabel={`${displayName(item)}, ${STATE_META[state].label}`}
        >
          <VehicleAvatar type={item.vehicle?.type} state={state} />
          <View style={styles.flex}>
            <View style={styles.nameLine}>
              <Text style={styles.name} numberOfLines={1}>{displayName(item)}</Text>
              {item.vehicle?.licensePlate ? (
                <View style={styles.plate}>
                  <Text style={styles.plateText} numberOfLines={1}>{item.vehicle.licensePlate}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.sub} numberOfLines={1}>{statusLine(item, units.fmtSpeed, now)}</Text>
          </View>
          <StatusPill state={state} compact />
          <Ionicons name="chevron-forward" size={16} color={colors.border} />
        </PressableScale>
      </FadeInUp>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or plate" label="Search vehicles" />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} count={counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>
      </View>

      {error ? <Banner text={`Showing the last update. ${error}`} /> : null}

      <FlatList
        data={rows}
        keyExtractor={(d) => d.deviceId}
        renderItem={row}
        ItemSeparatorComponent={() => <View style={styles.line} />}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={9}
        contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          devices.length === 0 ? (
            <EmptyState icon="bus-outline" tone="brand" title="No vehicles yet" note="Trackers added on the website will appear here." />
          ) : (
            <EmptyState icon="search" title="Nothing matches" note="Try another name, plate or status.">
              <Button
                variant="outline"
                title="Clear search and filters"
                onPress={() => {
                  setSearch("");
                  setFilter("all");
                }}
              />
            </EmptyState>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  top: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  list: { paddingBottom: space.lg },
  emptyList: { flexGrow: 1 },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 72, backgroundColor: colors.background },
  nameLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colors.foreground },
  plate: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  plateText: { fontSize: 11, fontWeight: "600", color: colors.mutedForeground, letterSpacing: 0.3 },
  sub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 3 },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg + 46 + space.md }
});
