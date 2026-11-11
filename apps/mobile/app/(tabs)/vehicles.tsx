import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Banner, Chip, EmptyState, ListSkeleton, RowLine, ScreenHeader, SearchBox, groupedRow } from "@/components/kit";
import { FadeInUp, LoadingBar } from "@/components/motion";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, countByFilter, selectDevices, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { ROW_HEIGHT, VehicleRow } from "@/fleet/VehicleRow";
import { colors, space } from "@/theme";

export default function VehiclesScreen() {
  const router = useRouter();
  const { devices, loading, error, units, refresh } = useFleet();
  const now = useNow();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<FleetFilter>("all");

  // Opened from a status tile on Home: start with that status chosen.
  useEffect(() => {
    const wanted = FILTERS.find((f) => f.key === params.filter);
    if (!wanted) return;
    setFilter(wanted.key);
    router.setParams({ filter: undefined });
  }, [params.filter, router]);
  const [search, setSearch] = useState("");
  const [pulling, setPulling] = useState(false);

  const counts = useMemo(() => countByFilter(devices), [devices]);
  const rows = useMemo(() => selectDevices(devices, filter, search), [devices, filter, search]);

  async function onPull() {
    setPulling(true);
    await refresh();
    setPulling(false);
  }

  const open = useCallback((deviceId: string) => router.push({ pathname: "/vehicle/[id]", params: { id: deviceId } }), [router]);
  const last = rows.length - 1;
  const row = useCallback(
    ({ item, index }: { item: FleetDevice; index: number }) => (
      <View style={groupedRow(index === 0, index === last)}>
        <VehicleRow device={item} fmtSpeed={units.fmtSpeed} now={now} onPress={open} />
      </View>
    ),
    [last, now, open, units.fmtSpeed]
  );

  const header = (
    <ScreenHeader title="Vehicles" badge={loading ? undefined : String(devices.length)}>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or plate" label="Search vehicles" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} count={loading ? undefined : counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>
    </ScreenHeader>
  );

  if (loading) {
    return (
      <View style={styles.wrap}>
        {header}
        <LoadingBar active />
        <View style={styles.loading}>
          <ListSkeleton />
        </View>
      </View>
    );
  }

  if (error && devices.length === 0) {
    return (
      <View style={styles.wrap}>
        {header}
        <EmptyState icon="cloud-offline-outline" tone="danger" title="Can't load vehicles" note={error}>
          <Button title="Try again" icon="refresh" onPress={() => void refresh()} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {header}
      {error ? <Banner text={`Showing the last update. ${error}`} /> : null}
      {/* Keyed by filter: choosing another status slides the new list in. */}
      <FadeInUp key={filter} style={styles.flex} distance={8}>
        <FlatList
          data={rows}
          keyExtractor={keyOf}
          renderItem={row}
          ItemSeparatorComponent={RowLine}
          // Every row has the same height, so the list never has to measure one.
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT + StyleSheet.hairlineWidth, offset: (ROW_HEIGHT + StyleSheet.hairlineWidth) * index + space.xs, index })}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews={Platform.OS === "android"}
          contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            devices.length === 0 ? (
              <EmptyState icon="car-outline" tone="brand" title="No vehicles yet" note="Trackers added on the website will appear here." />
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
      </FadeInUp>
    </View>
  );
}

const keyOf = (d: FleetDevice) => d.deviceId;

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  loading: { paddingTop: space.xs },
  list: { paddingTop: space.xs, paddingBottom: space.lg },
  emptyList: { flexGrow: 1 },
  // The chips run to the screen edge, so a chip half in view shows there are more to the side.
  chipScroll: { marginHorizontal: -space.lg },
  chips: { paddingHorizontal: space.lg, gap: 6 }
});
