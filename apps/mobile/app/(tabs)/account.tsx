import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, api, type ReadyResponse } from "@/api";
import { useSession } from "@/auth/SessionProvider";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Card } from "@/components/kit";
import { FadeInUp, PressableScale, PulseDot } from "@/components/motion";
import { Button } from "@/components/ui";
import { API_BASE_URL } from "@/config";
import { haptic } from "@/haptics";
import { DEFAULT_PREFS, PROBLEM_TEXT, PUSH_KINDS, type PushPrefs } from "@/push/model";
import { disablePush, enablePush, loadPrefs } from "@/push/service";
import { colors, elevation, font, gradient, space } from "@/theme";

type Check = { state: "checking" } | { state: "ok"; at: string } | { state: "failed"; reason: string };

export default function AccountScreen() {
  const { state, signOut } = useSession();
  const user = state.status === "signedIn" ? state.user : null;
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();
  const [push, setPush] = useState<PushPrefs>(DEFAULT_PREFS);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void loadPrefs().then(setPush);
  }, []);

  /** Shows the new choice at once, then saves it; puts the old choice back if saving fails. */
  async function changePush(next: PushPrefs) {
    const before = push;
    haptic.tap();
    setPush(next);
    setPushBusy(true);
    if (!next.enabled) await disablePush();
    else {
      const problem = await enablePush(next);
      if (problem) {
        setPush(before);
        Alert.alert("Notifications are still off", PROBLEM_TEXT[problem]);
      }
    }
    setPushBusy(false);
  }

  const run = useCallback(async () => {
    setCheck({ state: "checking" });
    try {
      const ready = await api.get<ReadyResponse>("health/ready");
      if (ready.status === "ready") setCheck({ state: "ok", at: new Date(ready.timestamp).toLocaleTimeString() });
      else setCheck({ state: "failed", reason: "The server is up but not ready." });
    } catch (error) {
      setCheck({ state: "failed", reason: error instanceof ApiError ? error.message : "Something went wrong." });
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need your password to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setLeaving(true);
          await signOut();
        }
      }
    ]);
  }

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <FadeInUp index={0}>
        <LinearGradient colors={gradient.brand} start={gradient.angle.start} end={gradient.angle.end} style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.heroName} numberOfLines={1}>{user?.name || "Signed in"}</Text>
            {user?.email ? <Text style={styles.heroEmail} numberOfLines={1}>{user.email}</Text> : null}
          </View>
        </LinearGradient>
      </FadeInUp>

      <FadeInUp index={1}>
        <Card>
          <View style={styles.cardHead}>
            <View style={styles.iconBadge}>
              <Ionicons name="cloud-done-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.label}>Server</Text>
              <Text style={styles.value}>{API_BASE_URL.replace(/^https?:\/\//, "")}</Text>
            </View>
          </View>
          <View style={styles.row}>
            {check.state === "checking" ? <ActivityIndicator color={colors.primary} /> : <PulseDot size={10} color={check.state === "ok" ? colors.success : colors.danger} live={check.state === "ok"} />}
            <Text style={styles.status}>
              {check.state === "checking" ? "Checking connection" : check.state === "ok" ? `Connected, checked at ${check.at}` : check.reason}
            </Text>
          </View>
          <Button variant="ghost" title="Check again" icon="refresh" onPress={run} />
        </Card>
      </FadeInUp>

      <FadeInUp index={2}>
        <Card style={styles.list}>
          <View style={styles.setting}>
            <View style={styles.iconBadge}>
              <Ionicons name="notifications-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.settingTitle}>Alert notifications</Text>
              <Text style={styles.settingNote}>Get alerts on this phone, even when the app is closed.</Text>
            </View>
            {pushBusy ? <ActivityIndicator color={colors.primary} /> : null}
            <Switch value={push.enabled} disabled={pushBusy} onValueChange={(on) => void changePush({ ...push, enabled: on })} trackColor={{ true: colors.primary }} accessibilityLabel="Alert notifications" />
          </View>
          {push.enabled
            ? PUSH_KINDS.map((kind) => (
                <View key={kind.key} style={[styles.setting, styles.sub]}>
                  <View style={styles.flex}>
                    <Text style={styles.subTitle}>{kind.label}</Text>
                    <Text style={styles.settingNote}>{kind.note}</Text>
                  </View>
                  <Switch value={push[kind.key]} disabled={pushBusy} onValueChange={(on) => void changePush({ ...push, [kind.key]: on })} trackColor={{ true: colors.primary }} accessibilityLabel={kind.label} />
                </View>
              ))
            : null}
        </Card>
      </FadeInUp>

      <FadeInUp index={3}>
        <Card style={styles.list}>
          <LinkRow icon="key-outline" label="Change password" onPress={() => router.push("/password")} />
          <LinkRow icon="help-circle-outline" label="Help" onPress={() => void Linking.openURL("https://www.riogps.com/help")} />
          <LinkRow icon="shield-checkmark-outline" label="Privacy policy" onPress={() => void Linking.openURL("https://www.riogps.com/privacy")} last />
        </Card>
      </FadeInUp>

      <FadeInUp index={4}>
        <Button variant="danger" title="Sign out" icon="log-out-outline" onPress={confirmSignOut} loading={leaving} />
      </FadeInUp>
      <Text style={styles.footer}>RIO GPS {Constants.expoConfig?.version ?? ""}</Text>
    </ScrollView>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; last?: boolean }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.985} style={[styles.link, !last && styles.linkLine]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.offline} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: space.xs },
  setting: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  sub: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingLeft: 40 + space.md },
  settingTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  subTitle: { fontSize: font.body, fontWeight: "600", color: colors.foreground },
  settingNote: { fontSize: font.small, color: colors.mutedForeground, marginTop: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 50 },
  linkLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  linkText: { flex: 1, fontSize: 16, fontWeight: "500", color: colors.foreground },
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
  flex: { flex: 1 },
  hero: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: 18, padding: space.lg, overflow: "hidden", ...elevation.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  heroName: { color: "#ffffff", fontSize: font.title, fontWeight: "700" },
  heroEmail: { color: "#d5defa", fontSize: font.small, marginTop: 2 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  iconBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  label: { fontSize: font.small, color: colors.mutedForeground },
  value: { fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.lg, marginBottom: space.xs, minHeight: 24, paddingLeft: 4 },
  status: { flex: 1, fontSize: font.body, color: colors.foreground },
  footer: { textAlign: "center", fontSize: font.small, color: colors.mutedForeground }
});
