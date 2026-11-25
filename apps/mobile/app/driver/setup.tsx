import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { useDriverSession } from "@/driver/DriverSession";
import { registerDriverPush } from "@/driver/push";
import { askLocation } from "@/driver/tracking";
import { colors, elevation, space, themed } from "@/theme";

type Step = "location" | "notifications" | "battery";
type Item = { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string; title: string; text: string };

const COPY: Record<Step, { header: string; icon: keyof typeof Ionicons.glyphMap; title: string; lead: string; items: Item[]; cta: string; later: string }> = {
  location: {
    header: "Location",
    icon: "location",
    title: "Share your location",
    lead: "Your company sees where you are while you're signed in to the app, with or without a load.",
    items: [
      { icon: "location-outline", color: "#136c35", soft: "#c8e8d2", title: "Shared while you're signed in", text: "Loads and ETAs stay right without calling dispatch." },
      { icon: "battery-half-outline", color: "#a3470a", soft: "#fcd9b2", title: "Easy on battery", text: "Updates often while driving, less when you're stopped." },
      { icon: "eye-outline", color: "#6526d1", soft: "#dccdfa", title: "You can always see it", text: "The app shows that it's sharing and what was shared." }
    ],
    cta: "Continue",
    later: "Not now"
  },
  notifications: {
    header: "Notifications",
    icon: "notifications",
    title: "Let dispatch reach you",
    lead: "Notifications tell you about loads, and when your company asks you to turn location back on.",
    items: [
      { icon: "cube-outline", color: "#1d4ed8", soft: "#dbe4f8", title: "New and changed loads", text: "Pickup times, stops and notes." },
      { icon: "location-outline", color: "#ad1f1f", soft: "#f6cdcd", title: "Location is off", text: "When it stops, and when dispatch asks you to turn it on." },
      { icon: "battery-dead-outline", color: "#a3470a", soft: "#fcd9b2", title: "Low battery", text: "At 20%, so the map doesn't lose you." }
    ],
    cta: "Allow notifications",
    later: "Not now"
  },
  battery: {
    header: "Keep tracking on",
    icon: "battery-charging",
    title: "Don't let battery saver stop RIO GPS",
    lead: "Some Android phones close apps in the background. Set RIO GPS to Unrestricted so your location keeps going all day.",
    items: [
      { icon: "battery-charging-outline", color: "#136c35", soft: "#c8e8d2", title: "Battery: Unrestricted", text: "Settings › Apps › RIO GPS › Battery" },
      { icon: "location-outline", color: "#a3470a", soft: "#fcd9b2", title: "Location: Allow all the time", text: "Settings › Apps › RIO GPS › Location" }
    ],
    cta: "Open settings",
    later: "Done"
  }
};

/** D2, D2B, D2C: location (Always), notifications, and on Android the battery setting. Once per sign-in. */
export default function DriverSetup() {
  const insets = useSafeAreaInsets();
  const { finishSetup, state } = useDriverSession();
  const [step, setStep] = useState<Step>("location");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const c = COPY[step];
  const company = state.status === "signedIn" ? state.me.company.name : "Your company";

  async function next(skip: boolean) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (step === "location") {
        if (!skip) {
          const p = await askLocation();
          if (p !== "always") setNote(p === "off" ? "Location is off. Your company won't see you until you turn it on." : "Choose “Allow all the time” in Settings so sharing works with the screen off.");
        }
        setStep("notifications");
      } else if (step === "notifications") {
        if (!skip) await registerDriverPush(true);
        if (Platform.OS === "android") setStep("battery");
        else await finishSetup();
      } else {
        if (!skip) await Linking.openSettings().catch(() => undefined);
        await finishSetup();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.header}>{c.header}</Text>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.hero}>
          <View style={styles.ring}>
            <View style={styles.dot}>
              <Ionicons name={c.icon} size={26} color={colors.primary} />
            </View>
          </View>
          {step === "location" ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{company} sees you</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title}>{c.title}</Text>
        <Text style={styles.lead}>{c.lead}</Text>
        <View style={styles.card}>
          {c.items.map((it, i) => (
            <View key={it.title} style={[styles.item, i > 0 && styles.itemLine]}>
              <View style={[styles.itemIcon, { backgroundColor: it.soft }]}>
                <Ionicons name={it.icon} size={19} color={it.color} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemTitle}>{it.title}</Text>
                <Text style={styles.itemText}>{it.text}</Text>
              </View>
            </View>
          ))}
        </View>
        {step === "location" ? (
          <View style={styles.next}>
            <Text style={styles.nextTitle}>Next, your phone asks twice</Text>
            <Text style={styles.nextText}>1 · Allow while using the app   2 · Change to Always allow</Text>
          </View>
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <View style={styles.flex} />
        <Button title={c.cta} icon="arrow-forward" onPress={() => next(false)} loading={busy} />
        <Button title={c.later} variant="ghost" onPress={() => next(true)} disabled={busy} />
      </ScrollView>
    </View>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: { textAlign: "center", fontSize: 17, fontWeight: "600", color: colors.foreground, paddingVertical: 14 },
  body: { flexGrow: 1, paddingHorizontal: space.lg, gap: space.md },
  hero: { height: 140, borderRadius: 20, backgroundColor: "#13286b", alignItems: "center", justifyContent: "center" },
  ring: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(37,99,235,0.35)", alignItems: "center", justifyContent: "center" },
  dot: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", ...elevation.md },
  tag: { position: "absolute", right: 12, bottom: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.16)" },
  tagText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: colors.foreground },
  lead: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
  card: { borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 14 },
  itemLine: { borderTopWidth: 1, borderTopColor: colors.muted },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 14.5, fontWeight: "700", color: colors.foreground },
  itemText: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  next: { padding: 12, borderRadius: 14, backgroundColor: colors.warningSoft, gap: 4 },
  nextTitle: { fontSize: 13, fontWeight: "700", color: colors.warning },
  nextText: { fontSize: 13, color: colors.foreground },
  note: { fontSize: 13, color: colors.danger }
}));
