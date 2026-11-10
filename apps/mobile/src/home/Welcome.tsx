import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FadeInUp } from "@/components/motion";
import { Button } from "@/components/ui";
import { colors, font, space } from "@/theme";

/** Bump the number to show the tips again after a big redesign. */
const SEEN_KEY = "rio.welcome-seen-v1";

const TIPS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; note: string }> = [
  { icon: "home", title: "Home shows your fleet at a glance", note: "Tap Moving, Idling, Stopped or Offline to see those vehicles." },
  { icon: "map", title: "Tap a vehicle on the map", note: "The map zooms to it. Follow keeps it centred as it drives." },
  { icon: "search", title: "Find any vehicle fast", note: "Use the search bar on the map to look up a name or plate." },
  { icon: "notifications", title: "Get alerts on this phone", note: "Turn on Alert notifications in Account, and set quiet hours for the night." }
];

/** A short list of tips, shown once after the first sign-in on this phone. */
export function Welcome() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (!seen) setOpen(true);
      })
      .catch(() => undefined);
  }, []);

  function close() {
    setOpen(false);
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => undefined);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Welcome to RIO GPS</Text>
          {TIPS.map((tip, i) => (
            <FadeInUp key={tip.title} index={i + 1} style={styles.tip}>
              <View style={styles.icon}>
                <Ionicons name={tip.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipNote}>{tip.note}</Text>
              </View>
            </FadeInUp>
          ))}
          <View style={styles.action}>
            <Button title="Got it" onPress={close} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,20,45,0.45)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.xl, paddingTop: space.md, gap: space.lg },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontSize: 22, fontWeight: "800", color: colors.foreground },
  tip: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  tipTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  tipNote: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2, lineHeight: 18 },
  action: { marginTop: space.sm, marginBottom: space.md }
});
