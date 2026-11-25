import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { ago } from "@/driver/model";
import { Group, Row } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

/** D14: opened from "turn on location" (push). Shows who asked and one big Turn on button. */
export default function LocationRequest() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ from?: string; message?: string; at?: string }>();
  const { state } = useDriverSession();
  const data = useDriverData();
  if (state.status !== "signedIn") return null;
  const { me } = state;
  const from = p.from || me.locationRequest?.from || "Your company";
  const at = p.at || me.locationRequest?.at || null;
  const on = data.permission === "always" && data.locationEnabled;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <View style={[styles.card, on && styles.cardOk]}>
        <View style={[styles.edge, { backgroundColor: on ? "#136c35" : "#9c1818" }]} />
        <View style={styles.top}>
          <View style={[styles.icon, { backgroundColor: on ? "#c8e8d2" : "#f4bcbc" }]}>
            <Ionicons name={on ? "checkmark-circle" : "location-outline"} size={26} color={on ? "#136c35" : "#9c1818"} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: on ? "#136c35" : "#9c1818" }]}>{on ? "Location is on" : "Dispatch is asking for your location"}</Text>
            <Text style={styles.sub}>
              {from} at {me.company.name}
              {at ? ` · ${ago(at)}` : ""}
            </Text>
          </View>
        </View>
        {p.message ? <Text style={styles.quote}>“{p.message}”</Text> : null}
        {on ? (
          <Pressable onPress={() => router.replace("/today")} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button">
            <Text style={styles.btnText}>Done</Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={data.openLocationSettings} style={styles.btn} accessibilityRole="button">
              <Ionicons name="location" size={18} color="#ffffff" />
              <Text style={styles.btnText}>Turn on location</Text>
            </Pressable>
            <Text style={styles.hint}>Opens your phone&apos;s settings. Choose Always, then come back.</Text>
          </>
        )}
      </View>
      <Group>
        {me.company.phone ? <Row icon="call-outline" color="#136c35" soft="#c8e8d2" title={`Call ${me.company.name}`} detail={me.company.phone} onPress={() => void Linking.openURL(`tel:${me.company.phone}`)} /> : null}
        <Row icon="home-outline" color="#1d4ed8" soft="#dbe4f8" title="Back to Today" onPress={() => router.replace("/today")} />
      </Group>
      <Text style={styles.fine}>Dispatch can ask at most once every 15 minutes. You always see when location is shared.</Text>
    </ScrollView>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { paddingHorizontal: space.lg, gap: space.md },
  flex: { flex: 1 },
  card: { position: "relative", gap: space.md, padding: 18, paddingLeft: 22, borderRadius: 20, backgroundColor: "#fdecec", borderWidth: 1.5, borderColor: "#e79a9a", overflow: "hidden" },
  cardOk: { backgroundColor: "#e9f7ee", borderColor: "#a7d8b8" },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, lineHeight: 25, fontWeight: "700" },
  sub: { fontSize: 13, color: "#3f4b5e" },
  quote: { padding: 12, borderRadius: 12, backgroundColor: "#ffffff", fontSize: 14, lineHeight: 20, color: "#0f172a" },
  btn: { height: 52, borderRadius: 14, backgroundColor: "#136c35", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
  hint: { fontSize: 12.5, textAlign: "center", color: "#3f4b5e" },
  fine: { fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground }
}));
