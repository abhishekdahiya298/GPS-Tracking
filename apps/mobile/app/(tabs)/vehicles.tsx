import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui";
import { useFleet, useNow } from "@/fleet/FleetProvider";
import { FILTERS, STATE_META, countByFilter, displayName, fleetState, selectDevices, statusLine, type FleetDevice, type FleetFilter } from "@/fleet/model";
import { colors, font, radius, space } from "@/theme";

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = { truck: "bus-outline", trailer: "cube-outline", van: "bus-outline", car: "car-outline" };

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
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Loading vehicles</Text>
      </View>
    );
  }

  if (error && devices.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.offline} />
        <Text style={styles.emptyTitle}>Can't load vehicles</Text>
        <Text style={styles.muted}>{error}</Text>
        <View style={styles.retry}>
          <Button title="Try again" onPress={() => void refresh()} />
        </View>
      </View>
    );
  }

  const row = ({ item }: { item: FleetDevice }) => {
    const meta = STATE_META[fleetState(item)];
    return (
      <Pressable
        onPress={() => router.push({ pathname: "/vehicle/[id]", params: { id: item.deviceId } })}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
        accessibilityRole="button"
        accessibilityLabel={`${displayName(item)}, ${meta.label}`}
      >
        <View style={[styles.icon, { backgroundColor: meta.soft }]}>
          <Ionicons name={TYPE_ICON[item.vehicle?.type ?? ""] ?? "navigate-outline"} size={22} color={meta.color} />
        </View>
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>{displayName(item)}</Text>
            {item.vehicle?.licensePlate ? <Text style={styles.plate} numberOfLines={1}>{item.vehicle.licensePlate}</Text> : null}
          </View>
          <Text style={styles.sub} numberOfLines={1}>{statusLine(item, units.fmtSpeed, now)}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: meta.soft }]}>
          <View style={[styles.dot, { backgroundColor: meta.color }]} />
          <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.offline} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or plate"
          placeholderTextColor={colors.offline}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search vehicles"
          style={styles.searchInput}
        />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {f.label} {counts[f.key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Showing the last update. {error}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(d) => d.deviceId}
        renderItem={row}
        ItemSeparatorComponent={() => <View style={styles.line} />}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.primary} colors={[colors.primary]} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name={devices.length === 0 ? "bus-outline" : "search"} size={36} color={colors.offline} />
            <Text style={styles.emptyTitle}>{devices.length === 0 ? "No vehicles yet" : "Nothing matches"}</Text>
            <Text style={styles.muted}>{devices.length === 0 ? "Trackers added on the website will appear here." : "Try another name, plate or status."}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm, backgroundColor: colors.background },
  retry: { marginTop: space.md, alignSelf: "stretch" },
  muted: { fontSize: font.body, color: colors.mutedForeground, textAlign: "center", lineHeight: 21 },
  emptyTitle: { fontSize: font.title, fontWeight: "600", color: colors.foreground, marginTop: space.sm },
  emptyList: { flexGrow: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: space.sm, margin: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.muted },
  searchInput: { flex: 1, fontSize: 16, color: colors.foreground, paddingVertical: space.sm },
  chips: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  chip: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.small, fontWeight: "500", color: colors.foreground },
  chipTextOn: { color: colors.primaryForeground },
  banner: { backgroundColor: colors.warningSoft, paddingHorizontal: space.lg, paddingVertical: space.sm },
  bannerText: { color: colors.warning, fontSize: font.small },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 68 },
  icon: { width: 44, height: 44, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  nameLine: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  name: { flexShrink: 1, fontSize: font.body, fontWeight: "600", color: colors.foreground },
  plate: { fontSize: font.small, color: colors.mutedForeground },
  sub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "600" },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg + 44 + space.md }
});
