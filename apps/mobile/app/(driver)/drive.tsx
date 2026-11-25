import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DriveMap } from "@/driver/DriveMap";
import { navigateTo, useDriverData } from "@/driver/DriverData";
import { currentLoad, loadStage, placeName } from "@/driver/model";
import { colors, elevation, space, themed } from "@/theme";

/** Map (D10): me on the map and the next stop, with Navigate. */
export default function Drive() {
  const insets = useSafeAreaInsets();
  const data = useDriverData();
  const load = currentLoad((data.loads ?? []).filter((l) => l.status !== "delivered"));
  const st = load ? loadStage(load.status) : null;
  const s = load && st?.next ? load[st.next] : null;
  const sharing = data.permission !== "off" && data.locationEnabled;
  return (
    <View style={styles.screen}>
      <DriveMap stop={s && st?.next ? { lat: s.lat, lon: s.lon, kind: st.next, title: placeName(s) } : null} />
      <View style={[styles.chip, { top: insets.top + space.sm }, !sharing && { backgroundColor: "#fdecec" }]}>
        <View style={[styles.dot, { backgroundColor: sharing ? "#16a34a" : "#c42b2b" }]} />
        <Text style={[styles.chipText, !sharing && { color: "#9c1818" }]}>{sharing ? "Sharing location" : "Location is off"}</Text>
      </View>
      {s && st?.next && load ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: st.next === "pickup" ? "#c8e8d2" : "#f6cdcd" }]}>
              <Ionicons name="location" size={20} color={st.next === "pickup" ? "#136c35" : "#ad1f1f"} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.label}>
                NEXT STOP · {st.next === "pickup" ? "PICKUP" : "DELIVERY"} · {load.reference}
              </Text>
              <Text style={styles.name}>{placeName(s)}</Text>
              <Text style={styles.addr} numberOfLines={1}>
                {s.address}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => navigateTo(s.lat, s.lon, placeName(s))} style={styles.nav} accessibilityRole="button">
            <Ionicons name="navigate" size={18} color="#ffffff" />
            <Text style={styles.navText}>Navigate</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  chip: { position: "absolute", left: space.lg, flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 99, backgroundColor: colors.background, ...elevation.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { fontSize: 13.5, fontWeight: "700", color: colors.foreground },
  card: { position: "absolute", left: space.md, right: space.md, bottom: space.md, gap: space.md, padding: 14, borderRadius: 18, backgroundColor: colors.background, ...elevation.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: colors.mutedForeground },
  name: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  addr: { fontSize: 13, color: colors.mutedForeground },
  nav: { height: 48, borderRadius: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  navText: { fontSize: 15, fontWeight: "700", color: "#ffffff" }
}));
