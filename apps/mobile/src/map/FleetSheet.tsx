import { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, EmptyState, SearchBox } from "@/components/kit";
import { FILTERS, STATE_META, countByFilter, selectDevices, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { ROW_HEIGHT, VehicleRow } from "@/fleet/VehicleRow";
import { colors, radius, space, type } from "@/theme";

/**
 * The fleet list that slides up over the map: search, status chips, and every vehicle.
 * Picking one closes the sheet and the map flies to it. The status filter is shared with
 * the map, so the list and the map always show the same vehicles.
 */
export function FleetSheet({
  visible,
  devices,
  filter,
  onFilter,
  fmtSpeed,
  now,
  onPick,
  onClose
}: {
  visible: boolean;
  devices: FleetDevice[];
  filter: FleetFilter;
  onFilter: (f: FleetFilter) => void;
  fmtSpeed: (kph: number | null) => string;
  now: number;
  onPick: (deviceId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const counts = useMemo(() => countByFilter(devices), [devices]);
  const rows = useMemo(() => selectDevices(devices, filter, search), [devices, filter, search]);
  const close = () => {
    setSearch("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={close}>
      <SafeAreaView style={styles.wrap} edges={Platform.OS === "ios" ? ["bottom"] : ["top", "bottom"]}>
        <View style={styles.head}>
          <Text style={styles.title}>{devices.length === 1 ? "1 vehicle" : `${devices.length} vehicles`}</Text>
          {/* Map / List: the list is open, so Map closes it and shows the same vehicles on the map. */}
          <View style={styles.toggle} accessibilityRole="tablist">
            <Pressable onPress={close} style={styles.toggleItem} accessibilityRole="tab" accessibilityState={{ selected: false }} accessibilityLabel="Map view">
              <Ionicons name="map-outline" size={18} color={colors.foreground} />
            </Pressable>
            <View style={[styles.toggleItem, styles.toggleOn]} accessibilityRole="tab" accessibilityState={{ selected: true }} accessibilityLabel="List view">
              <Ionicons name="list" size={18} color={colors.primaryForeground} />
            </View>
          </View>
        </View>
        <View style={styles.search}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or plate" label="Search vehicles" />
        </View>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} count={counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} glyph={f.key} onPress={() => onFilter(f.key)} />
            ))}
          </ScrollView>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(d) => d.deviceId}
          renderItem={({ item }) => (
            <VehicleRow
              device={item}
              fmtSpeed={fmtSpeed}
              now={now}
              onPress={(id) => {
                setSearch("");
                onPick(id);
              }}
            />
          )}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          initialNumToRender={12}
          windowSize={9}
          contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={<EmptyState icon="search" title="Nothing matches" note="Try another name, plate or status." />}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.md },
  title: { ...type.title },
  toggle: { flexDirection: "row", padding: 3, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  toggleItem: { width: 44, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  toggleOn: { backgroundColor: colors.primary },
  search: { paddingHorizontal: space.lg, paddingTop: space.sm },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 6 },
  emptyList: { flexGrow: 1 },
});
