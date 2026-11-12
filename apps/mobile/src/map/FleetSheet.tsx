import { useMemo, useState } from "react";
import { FlatList, Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, EmptyState, SearchBox } from "@/components/kit";
import { Button } from "@/components/ui";
import { FILTERS, STATE_META, countByFilter, selectDevices, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { ROW_HEIGHT, ROW_INSET, VehicleRow } from "@/fleet/VehicleRow";
import { colors, space, type, themed } from "@/theme";

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
          <Text style={styles.title}>Find a vehicle</Text>
          <Button variant="ghost" title="Done" onPress={close} />
        </View>
        <View style={styles.search}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Search name or plate" label="Search vehicles" />
        </View>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} count={counts[f.key]} selected={f.key === filter} dot={f.key === "all" ? undefined : STATE_META[f.key].color} onPress={() => onFilter(f.key)} />
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
          ItemSeparatorComponent={() => <View style={styles.line} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT + StyleSheet.hairlineWidth, offset: (ROW_HEIGHT + StyleSheet.hairlineWidth) * index, index })}
          initialNumToRender={12}
          windowSize={9}
          contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={<EmptyState icon="search" title="Nothing matches" note="Try another name, plate or status." />}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.md },
  title: { ...type.title },
  search: { paddingHorizontal: space.lg, paddingTop: space.sm },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 6 },
  emptyList: { flexGrow: 1 },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: ROW_INSET }
}));
