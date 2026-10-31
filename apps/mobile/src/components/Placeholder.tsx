import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space } from "../theme";

/** A screen that isn't built yet: says what will be here, so the navigation can be tested. */
export function Placeholder({ icon, title, note }: { icon: keyof typeof Ionicons.glyphMap; title: string; note: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: colors.canvas },
  badge: { width: 64, height: 64, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: space.lg },
  title: { fontSize: font.title, fontWeight: "600", color: colors.foreground, marginBottom: space.xs },
  note: { fontSize: font.body, color: colors.mutedForeground, textAlign: "center", lineHeight: 21 }
});
