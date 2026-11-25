import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AuthShell, AuthTabs } from "@/components/AuthShell";
import { colors, space, themed } from "@/theme";

type Choice = { key: "fleet" | "operator" | "broker" | "driver"; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap; color: string; soft: string };
const CHOICES: Choice[] = [
  { key: "fleet", title: "I run trucks", detail: "Owner or manager", icon: "car-sport-outline", color: "#1d4ed8", soft: "#dbe4f8" },
  { key: "operator", title: "Owner-operator", detail: "I drive my own truck", icon: "person-outline", color: "#136c35", soft: "#c8e8d2" },
  { key: "broker", title: "I book loads", detail: "Broker or dispatcher", icon: "cube-outline", color: "#6526d1", soft: "#dccdfa" },
  { key: "driver", title: "I'm a driver", detail: "Join my company", icon: "call-outline", color: "#a3470a", soft: "#fcd9b2" }
];

/** S1: tap what describes you; the tap moves on (no extra button). */
export default function SignupRole() {
  const router = useRouter();
  return (
    <AuthShell title="Create your free account" tagline="Track trucks and drivers live. No card." footer="Step 1 of 3">
      <AuthTabs active="signup" />
      <Text style={styles.q}>What describes you?</Text>
      {CHOICES.map((c) => (
        <Pressable
          key={c.key}
          onPress={() => (c.key === "driver" ? router.push("/driver?join=1") : router.push({ pathname: "/signup/details", params: { role: c.key } }))}
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
      ))}
    </AuthShell>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  q: { fontSize: 15, fontWeight: "700", color: colors.foreground, marginTop: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 58, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  pressed: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  detail: { fontSize: 13, color: colors.mutedForeground }
}));
