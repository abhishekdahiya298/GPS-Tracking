import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AuthShell, DRIVER_TONE, LinkCard, StepDots } from "@/components/AuthShell";
import { FadeInUp } from "@/components/motion";
import { colors, space, themed } from "@/theme";

type Choice = { key: "fleet" | "operator" | "broker"; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap; color: string; soft: string };
const CHOICES: Choice[] = [
  { key: "fleet", title: "I run trucks", detail: "Owner or manager", icon: "car-sport-outline", color: "#1d4ed8", soft: "#dbe4f8" },
  { key: "operator", title: "Owner-operator", detail: "I drive my own truck", icon: "person-outline", color: "#136c35", soft: "#c8e8d2" },
  { key: "broker", title: "I book loads", detail: "Broker or freight agent", icon: "cube-outline", color: "#6526d1", soft: "#dccdfa" }
];

/** S1: tap what describes you; the tap moves on (no extra button). */
export default function SignupRole() {
  const router = useRouter();
  return (
    <AuthShell back={router.canGoBack()} title="Create your" accent="free account" tagline="Track trucks, drivers and loads live. No card.">
      <StepDots step={1} />
      <Text style={styles.q}>What describes you?</Text>
      {CHOICES.map((c, i) => (
        <FadeInUp key={c.key} index={i + 2}>
        <Pressable
          onPress={() => router.push({ pathname: "/signup/details", params: { role: c.key } })}
          accessibilityRole="button"
          accessibilityLabel={`${c.title}. ${c.detail}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={[styles.icon, { backgroundColor: c.soft }]}>
            <Ionicons name={c.icon} size={19} color={c.color} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>{c.title}</Text>
            <Text style={styles.detail}>{c.detail}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
        </FadeInUp>
      ))}
      <LinkCard icon="car-outline" color={DRIVER_TONE.main} soft={DRIVER_TONE.soft} title="Driving for someone?" detail="Use your mobile number. Free, no company needed." onPress={() => router.replace("/driver")} />
    </AuthShell>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  q: { fontSize: 18, fontWeight: "800", color: colors.foreground, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 62, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  pressed: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  detail: { fontSize: 13, color: colors.mutedForeground }
}));
