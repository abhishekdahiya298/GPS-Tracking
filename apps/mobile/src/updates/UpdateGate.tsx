import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Image, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "../config";
import { Button } from "../components/ui";
import { colors, font, radius, space } from "../theme";
import { APP_PLATFORM, APP_VERSION, onUpdateRequired } from "./events";
import { fetchUpdatePolicy, isSnoozed, type UpdateCheck } from "./policy";

const SNOOZE_KEY = "rio.update-later";
/** Check again when the app comes back after this long, and every few hours while open. */
const RECHECK_MS = 5 * 60_000;
const PERIODIC_MS = 6 * 3_600_000;

/** The store page for this app when the server gave no link (app.json ios.appStoreUrl / android.package). */
function fallbackStoreUrl(): string | null {
  if (Platform.OS === "ios") return Constants.expoConfig?.ios?.appStoreUrl ?? null;
  const pkg = Constants.expoConfig?.android?.package;
  return pkg ? `market://details?id=${pkg}` : null;
}

async function openUpdate(url: string | null) {
  const target = url ?? fallbackStoreUrl();
  if (!target) return;
  try {
    await Linking.openURL(target);
  } catch {
    // market:// can fail on phones without the Play Store: fall back to the web page.
    const pkg = Constants.expoConfig?.android?.package;
    if (pkg) await Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`).catch(() => {});
  }
}

/**
 * Keeps the app on a supported version (server-decided, see the platform console's Mobile app page):
 * - "required": a full-screen Update required page replaces the whole app; there is no way past it.
 * - "optional": an Update available sheet, with Later (asks again after a day or for a newer version).
 * Checked on start, when the app returns to the foreground, every 6 hours, and at once if the
 * API refuses this version (426). A failed check never blocks the app.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [forced, setForced] = useState(false);
  const [snooze, setSnooze] = useState<{ version: string; at: number } | null>(null);
  const lastRun = useRef(0);

  const run = useCallback(async () => {
    lastRun.current = Date.now();
    const r = await fetchUpdatePolicy({ baseUrl: API_BASE_URL, platform: APP_PLATFORM, version: APP_VERSION });
    if (!r) return;
    setCheck(r);
    setForced(r.status === "required");
  }, []);

  useEffect(() => {
    void SecureStore.getItemAsync(SNOOZE_KEY)
      .then((v) => v && setSnooze(JSON.parse(v) as { version: string; at: number }))
      .catch(() => {});
    void run();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - lastRun.current > RECHECK_MS) void run();
    });
    const timer = setInterval(() => void run(), PERIODIC_MS);
    const off = onUpdateRequired(() => {
      setForced(true);
      void run();
    });
    return () => {
      sub.remove();
      clearInterval(timer);
      off();
    };
  }, [run]);

  if (forced) return <UpdateRequired check={check} onRetry={run} />;

  const offer = check?.status === "optional" && !isSnoozed(snooze, check.latestVersion);
  const later = () => {
    if (!check?.latestVersion) return;
    const s = { version: check.latestVersion, at: Date.now() };
    setSnooze(s);
    void SecureStore.setItemAsync(SNOOZE_KEY, JSON.stringify(s)).catch(() => {});
  };
  return (
    <>
      {children}
      <Modal visible={offer} transparent animationType="slide" onRequestClose={later}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Update available</Text>
            <Text style={styles.body}>
              RIO GPS {check?.latestVersion} is ready. You have {APP_VERSION}.
            </Text>
            {check?.notes ? <Text style={styles.notes}>{check.notes}</Text> : null}
            <View style={styles.actions}>
              <Button title="Update now" onPress={() => void openUpdate(check?.updateUrl ?? null)} />
              <Button title="Later" variant="ghost" onPress={later} />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function UpdateRequired({ check, onRetry }: { check: UpdateCheck | null; onRetry: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  const url = check?.updateUrl ?? fallbackStoreUrl();
  return (
    <SafeAreaView style={styles.full} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.fullInner}>
        <View style={styles.logoPlate}>
          {/* eslint-disable-next-line @typescript-eslint/no-require-imports -- React Native's way to bundle an image */}
          <Image source={require("../../assets/icon.png")} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Update required
        </Text>
        <Text style={styles.lead}>This version of RIO GPS is no longer supported. Update the app to keep tracking your fleet and loads.</Text>
        <View style={styles.versions}>
          <Text style={styles.versionText}>Your version: {APP_VERSION}</Text>
          {check?.minVersion ? <Text style={styles.versionText}>Needed: {check.minVersion} or newer</Text> : null}
        </View>
        {check?.notes ? (
          <View style={styles.whatsNew}>
            <Text style={styles.whatsNewTitle}>What&apos;s new</Text>
            <Text style={styles.whatsNewText}>{check.notes}</Text>
          </View>
        ) : null}
        <View style={styles.fullActions}>
          {url ? <Button title="Update now" onPress={() => void openUpdate(check?.updateUrl ?? null)} /> : <Text style={styles.lead}>Open the {Platform.OS === "ios" ? "App Store" : "Play Store"} and update RIO GPS.</Text>}
          <Button
            title="I've updated, check again"
            variant="ghost"
            loading={checking}
            onPress={() => {
              setChecking(true);
              void onRetry().finally(() => setChecking(false));
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: colors.primaryDark },
  fullInner: { flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg },
  logoPlate: { alignSelf: "center", backgroundColor: colors.background, borderRadius: 24, padding: space.md },
  logo: { width: 96, height: 96 },
  title: { color: colors.primaryForeground, fontSize: 28, fontWeight: "700", textAlign: "center" },
  lead: { color: "#dbe4f7", fontSize: font.body, lineHeight: 22, textAlign: "center" },
  versions: { alignSelf: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.lg, gap: 2 },
  versionText: { color: colors.primaryForeground, fontSize: font.small, textAlign: "center" },
  whatsNew: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  whatsNewTitle: { color: colors.primaryForeground, fontWeight: "600", fontSize: font.body },
  whatsNewText: { color: "#dbe4f7", fontSize: font.small, lineHeight: 19 },
  fullActions: { gap: space.sm, marginTop: space.sm },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,36,99,0.45)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.xl, gap: space.md },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { fontSize: font.title, fontWeight: "700", color: colors.primaryDark },
  body: { fontSize: font.body, color: colors.foreground, lineHeight: 22 },
  notes: { fontSize: font.small, color: colors.mutedForeground, lineHeight: 19 },
  actions: { gap: space.sm }
});
