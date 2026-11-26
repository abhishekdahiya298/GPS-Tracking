import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowButton, DRIVER_TONE, OutlineButton } from "@/components/AuthShell";
import { FadeInUp } from "@/components/motion";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { Group, Row } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

/** D15: a company removed the driver (or made them inactive). The account and record stay. */
export default function DriverRemoved() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ company?: string }>();
  const session = useDriverSession();
  const data = useDriverData();
  useEffect(() => {
    void session.refresh();
    void data.refresh();
  }, []);
  if (session.state.status !== "signedIn") return null;
  const me = session.state.me;
  const still = data.companies.filter((c) => c.link === "active");
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]}>
      <FadeInUp>
        <View style={[styles.card, styles.alert]}>
          <View style={styles.top}>
            <View style={styles.icon}>
              <Ionicons name="business" size={22} color="#ad1f1f" />
            </View>
            <Text style={styles.title}>{p.company || "A company"} removed you</Text>
          </View>
          <Text style={styles.text}>
            They no longer see your location or send you loads. <Text style={styles.bold}>Your account, profile and driving record stay with you.</Text>
          </Text>
        </View>
      </FadeInUp>
      <FadeInUp index={1}>
        <View style={styles.card}>
          <Text style={styles.h2}>{still.length ? "You still drive for" : "You're on your own account"}</Text>
          {still.length ? (
            still.map((c) => (
              <View key={c.id} style={styles.company}>
                <Ionicons name="checkmark-circle" size={20} color="#136c35" />
                <Text style={styles.companyName}>{c.company.name}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.text}>No company sees your location now. When a carrier adds your number, their request shows on Today.</Text>
          )}
        </View>
      </FadeInUp>
      <FadeInUp index={2}>
        <View style={styles.card}>
          <Text style={styles.h2}>Work with another carrier</Text>
          <Text style={styles.text}>Give them your number. Their request shows on Today and you choose Accept.</Text>
          <OutlineButton tone={DRIVER_TONE} title="Share my number" icon="share-social-outline" onPress={() => void Share.share({ message: `Add me as a driver in RIO GPS: ${me.driver.phone}` })} />
        </View>
      </FadeInUp>
      <Group>
        <Row icon="bar-chart-outline" color="#1d4ed8" soft="#dbe4f8" title="My record" detail="Trips, hours and miles" onPress={() => router.push("/driver/reports")} />
        <Row icon="business-outline" color="#6d28d9" soft="#e6dcfb" title="Companies I work for" detail="Requests, who sees me, leave" onPress={() => router.push("/driver/record")} />
      </Group>
      <ArrowButton tone={DRIVER_TONE} title="Go to Today" onPress={() => router.replace("/today")} />
    </ScrollView>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { paddingHorizontal: space.lg, gap: space.md },
  card: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  alert: { borderLeftWidth: 5, borderLeftColor: "#ad1f1f" },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#f6cdcd", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: colors.foreground },
  text: { fontSize: 14, lineHeight: 20, color: colors.foreground },
  bold: { fontWeight: "700" },
  h2: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  company: { flexDirection: "row", alignItems: "center", gap: 8 },
  companyName: { fontSize: 15, fontWeight: "600", color: colors.foreground }
}));
