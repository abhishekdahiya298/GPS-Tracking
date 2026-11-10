import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Banner, Chip, EmptyState, ListSkeleton, SearchBox } from "@/components/kit";
import { FadeInUp, Skeleton } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, countByFilter, selectDevices, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { ROW_INSET, VehicleRow } from "@/fleet/VehicleRow";
import { colors, radius, space } from "@/theme";

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

  const open = (deviceId: string) => router.push({ pathname: "/vehicle/[id]", params: { id: deviceId } });
  const row = ({ item, index }: { item: FleetDevice; index: number }) => (
    // Only the first screenful staggers in; rows reached by scrolling appear at once.
    <FadeInUp index={index < 10 ? index : 0} distance={index < 10 ? 12 : 0}>
      <VehicleRow device={item} fmtSpeed={units.fmtSpeed} now={now} onPress={open} />
    </FadeInUp>
  );

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
  top: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  list: { paddingBottom: space.lg },
  emptyList: { flexGrow: 1 },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: ROW_INSET }
});
