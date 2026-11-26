import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Image, Text, View } from "react-native";
import { ArrowButton, AUTH_IMAGES, AuthShell, DRIVER_TONE, FLEET_TONE, OutlineButton, type Tone } from "@/components/AuthShell";
import { FadeInUp } from "@/components/motion";
import { colors, isDark, space, themed } from "@/theme";

/** W0: the first screen. Two clear paths: drivers (mobile number, no company needed) and fleets or brokers. */
export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <AuthShell title="Everything you" accent="move, live" tagline="Trucks, drivers and loads on one map, for fleets in Canada and the US." photo="truck">
      <Text style={styles.h1} accessibilityRole="header">
        How will you use RIO GPS?
      </Text>
      <FadeInUp index={2}>
        <RoleCard tone={DRIVER_TONE} image={AUTH_IMAGES.driver} icon="car-outline" title="I'm a driver" text="Free, no company needed. Get loads and requests on your phone." cta="Continue with mobile number" onPress={() => router.push("/driver")} />
      </FadeInUp>
      <FadeInUp index={3}>
        <RoleCard tone={FLEET_TONE} image={AUTH_IMAGES.fleet} icon="grid-outline" title="I run trucks or loads" text="Carriers, dispatchers and brokers: track trucks, drivers and loads." cta="Create account" onPress={() => router.push("/signup")} />
      </FadeInUp>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>Already have an account?</Text>
        <View style={styles.line} />
      </View>
      <OutlineButton title="Sign in" icon="log-in-outline" onPress={() => router.push("/login")} />
    </AuthShell>
  );
}

function RoleCard({ tone, image, icon, title, text, cta, onPress }: { tone: Tone; image: number; icon: keyof typeof Ionicons.glyphMap; title: string; text: string; cta: string; onPress: () => void }) {
  return (
    <View style={[styles.card, { borderColor: tone.border }]}>
      <LinearGradient colors={isDark ? [colors.muted, colors.muted] : [tone.soft, tone === DRIVER_TONE ? "#ffe1c2" : "#e3ecff"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
      <Image source={image} style={styles.pic} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: tone.main }]}>
            <Ionicons name={icon} size={18} color="#ffffff" />
          </View>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.text}>{text}</Text>
        <ArrowButton title={cta} tone={tone} onPress={onPress} />
      </View>
    </View>
  );
}

const styles = themed(() => ({
  h1: { fontSize: 19, fontWeight: "800", textAlign: "center", color: isDark ? colors.foreground : "#0a1f5c" },
  card: { flexDirection: "row", borderRadius: 18, borderWidth: 1.5, overflow: "hidden", minHeight: 160 },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  pic: { width: 104, height: "100%" },
  body: { flex: 1, padding: 12, gap: 7, justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: isDark ? colors.foreground : "#0a1f5c" },
  text: { fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground },
  divider: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 13.5, fontWeight: "600", color: colors.primary }
}));
