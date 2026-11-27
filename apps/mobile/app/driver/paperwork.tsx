import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api";
import { FadeInUp, PopIn, PressableScale } from "@/components/motion";
import { driver, type LoadPaperwork, type PaperworkLine } from "@/driver/api";
import { camera, files, flushPaperwork, pendingCount, photos, scan, sendPaperwork, type Captured } from "@/driver/capture";
import { driverStyles as ds } from "@/driver/parts";
import { colors, radius, space, themed } from "@/theme";

/**
 * Load paperwork (driver): what to send at pickup and delivery. Documents open the scanner,
 * photos the camera; "More" offers the other ways. Nothing blocks the load: required items
 * show as missing and the company is told; with no signal, captures wait and send later.
 */
export default function PaperworkScreen() {
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();
  const insets = useSafeAreaInsets();
  const [pw, setPw] = useState<LoadPaperwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [justSent, setJustSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await flushPaperwork();
      setPw(await driver.paperwork(id));
      setWaiting(await pendingCount(id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the paperwork.");
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function capture(item: PaperworkLine, how: "scan" | "camera" | "photos" | "files") {
    setBusy(item.key);
    try {
      const got: Captured[] = how === "scan" ? await scan() : how === "camera" ? await camera() : how === "photos" ? await photos() : await files();
      if (!got.length) return;
      let queued = false;
      for (const c of got) {
        const r = await sendPaperwork(id, item.key, c);
        if (r === "queued") queued = true;
        else setPw(r);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJustSent(item.key);
      setTimeout(() => setJustSent((k) => (k === item.key ? null : k)), 2500);
      if (queued) {
        setWaiting(await pendingCount(id));
        Alert.alert("Saved on your phone", "No signal right now. It sends by itself when you're back online.");
      }
    } catch (e) {
      Alert.alert("Couldn't add it", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  function more(item: PaperworkLine) {
    const options = [item.kind === "doc" ? "Take a photo instead" : "Scan as a document", "Choose from photos", "Choose a file (PDF)", "Cancel"];
    const pick = (i: number) => {
      if (i === 0) void capture(item, item.kind === "doc" ? "camera" : "scan");
      if (i === 1) void capture(item, "photos");
      if (i === 2) void capture(item, "files");
    };
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 3, title: item.label }, pick);
    else Alert.alert(item.label, undefined, [...options.slice(0, 3).map((text, i) => ({ text, onPress: () => pick(i) })), { text: "Cancel", style: "cancel" as const }]);
  }

  const stops = (["pickup", "delivery"] as const).map((s) => ({ s, items: pw?.items.filter((i) => i.stop === s) ?? [] })).filter((x) => x.items.length);

  return (
    <ScrollView
      style={ds.screen}
      contentContainerStyle={[ds.body, { paddingTop: space.lg, paddingBottom: insets.bottom + space.xl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />}
    >
      <Stack.Screen options={{ title: ref ? `Paperwork · ${ref}` : "Paperwork" }} />
      {pw && pw.missing > 0 ? (
        <PopIn>
          <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={[styles.bannerText, { color: colors.danger }]}>
              {pw.missing === 1 ? "1 required item is missing." : `${pw.missing} required items are missing.`} Your load keeps going; add it when you can.
            </Text>
          </View>
        </PopIn>
      ) : pw && pw.items.length ? (
        <View style={[styles.banner, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={[styles.bannerText, { color: colors.success }]}>Nothing missing so far.</Text>
        </View>
      ) : null}
      {waiting > 0 ? (
        <View style={[styles.banner, { backgroundColor: colors.muted }]}>
          <Ionicons name="cloud-upload-outline" size={20} color={colors.mutedForeground} />
          <Text style={[styles.bannerText, { color: colors.mutedForeground }]}>{waiting} waiting for a signal. It sends by itself.</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!pw && !error ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : null}
      {pw && pw.items.length === 0 ? <Text style={ds.sub}>No paperwork is needed for this load.</Text> : null}
      {stops.map(({ s, items }) => (
        <View key={s} style={{ gap: space.sm }}>
          <Text style={ds.section}>{s === "pickup" ? "AT PICKUP" : "AT DELIVERY"}</Text>
          {items.map((i, n) => {
            const done = i.count > 0;
            const tone = done ? colors.success : i.missing ? colors.danger : colors.mutedForeground;
            return (
              <FadeInUp key={i.key} index={n}>
                <View style={[styles.item, i.missing && { borderColor: colors.danger }, justSent === i.key && { borderColor: colors.success }]}>
                  <View style={[styles.icon, { backgroundColor: done ? colors.successSoft : i.missing ? colors.dangerSoft : colors.primarySoft }]}>
                    <Ionicons name={done ? "checkmark" : i.kind === "doc" ? "document-text-outline" : "camera-outline"} size={20} color={done ? colors.success : i.missing ? colors.danger : colors.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.label}>
                      {i.label}
                      {i.mode === "required" ? <Text style={{ color: colors.danger }}> *</Text> : null}
                    </Text>
                    <Text style={[styles.state, { color: tone }]}>
                      {done ? `${i.count} sent${i.last ? ` · ${new Date(i.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : i.missing ? "Missing" : i.mode === "required" ? (i.due ? "Missing" : "Needed at this stop") : "Optional"}
                    </Text>
                  </View>
                  {busy === i.key ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <View style={styles.actions}>
                      <PressableScale onPress={() => void capture(i, i.kind === "doc" ? "scan" : "camera")} style={styles.primary} accessibilityRole="button" accessibilityLabel={`${i.kind === "doc" ? "Scan" : "Take a photo of"} ${i.label}`}>
                        <Ionicons name={i.kind === "doc" ? "scan-outline" : "camera"} size={16} color="#fff" />
                        <Text style={styles.primaryText}>{done ? "Add" : i.kind === "doc" ? "Scan" : "Photo"}</Text>
                      </PressableScale>
                      <Pressable onPress={() => more(i)} style={styles.more} hitSlop={6} accessibilityRole="button" accessibilityLabel={`More ways to add ${i.label}`}>
                        <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
                      </Pressable>
                    </View>
                  )}
                </View>
              </FadeInUp>
            );
          })}
        </View>
      ))}
      <Text style={styles.fine}>Time and place are saved with each item. Only the company that sent this load sees it.</Text>
    </ScrollView>
  );
}

const styles = themed(() => ({
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: 12, borderRadius: radius.lg },
  bannerText: { flex: 1, fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  state: { fontSize: 12.5, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  primary: { flexDirection: "row", alignItems: "center", gap: 5, height: 38, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.primary },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  more: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  fine: { fontSize: 12, color: colors.mutedForeground, textAlign: "center", marginTop: space.md }
}));
