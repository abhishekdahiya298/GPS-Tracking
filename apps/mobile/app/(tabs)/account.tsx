import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, api, type ReadyResponse } from "@/api";
import { useSession } from "@/auth/SessionProvider";
import { Ionicons } from "@expo/vector-icons";
import { reloadAppAsync } from "expo";
import { Card, ScreenHeader, SectionLabel, Segmented } from "@/components/kit";
import { FadeInUp, PressableScale, PulseDot } from "@/components/motion";
import { Button } from "@/components/ui";
import { API_BASE_URL } from "@/config";
import { haptic } from "@/haptics";
import { useFleet } from "@/fleet/FleetProvider";
import { DEFAULT_PREFS, PROBLEM_TEXT, PUSH_KINDS, clockText, wrapMinutes, type PushPrefs } from "@/push/model";
import { disablePush, enablePush, loadPrefs } from "@/push/service";
import { colors, font, ink, radius, saveThemeChoice, size, space, themeChoice, type, type ThemeChoice } from "@/theme";

type Check = { state: "checking" } | { state: "ok"; at: string } | { state: "failed"; reason: string };

export default function AccountScreen() {
  const { state, signOut } = useSession();
  const user = state.status === "signedIn" ? state.user : null;
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();
  const { timeFormat } = useFleet();
  const [push, setPush] = useState<PushPrefs>(DEFAULT_PREFS);
  const [pushBusy, setPushBusy] = useState(false);
  const [look, setLook] = useState<ThemeChoice>(themeChoice);

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

  /** Saves the look and restarts the app, so every screen is drawn in it. Takes well under a second. */
  function changeLook(next: ThemeChoice) {
    if (next === look) return;
    setLook(next);
    saveThemeChoice(next);
    // Let the switch finish sliding before the restart.
    setTimeout(() => void reloadAppAsync("Look changed").catch(() => Alert.alert("Close and reopen the app", "The new look applies the next time RIO GPS opens.")), 250);
  }

  const initials = (user?.name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Account" />
      <ScrollView contentContainerStyle={styles.content}>
        <FadeInUp index={0}>
          <Card style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={type.section} numberOfLines={1}>{user?.name || "Signed in"}</Text>
              {user?.email ? <Text style={type.small} numberOfLines={1}>{user.email}</Text> : null}
            </View>
          </Card>
        </FadeInUp>

        <FadeInUp index={1}>
          <SectionLabel text="Notifications" />
          <Card style={styles.group}>
            <View style={styles.setting}>
              <Ionicons name="notifications-outline" size={size.icon} color={colors.mutedForeground} />
              <View style={styles.flex}>
                <Text style={styles.settingTitle}>Alert notifications</Text>
                <Text style={type.small}>On this phone, even when the app is closed.</Text>
              </View>
              {pushBusy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              <Switch value={push.enabled} disabled={pushBusy} onValueChange={(on) => void changePush({ ...push, enabled: on })} trackColor={{ true: colors.primary }} accessibilityLabel="Alert notifications" />
            </View>
            {push.enabled
              ? PUSH_KINDS.map((kind) => (
                  <View key={kind.key} style={[styles.setting, styles.sub]}>
                    <View style={styles.flex}>
                      <Text style={styles.settingTitle}>{kind.label}</Text>
                      <Text style={type.small}>{kind.note}</Text>
                    </View>
                    <Switch value={push[kind.key]} disabled={pushBusy} onValueChange={(on) => void changePush({ ...push, [kind.key]: on })} trackColor={{ true: colors.primary }} accessibilityLabel={kind.label} />
                  </View>
                ))
              : null}
            {push.enabled ? (
              <View style={[styles.setting, styles.line]}>
                <Ionicons name="moon-outline" size={size.icon} color={colors.mutedForeground} />
                <View style={styles.flex}>
                  <Text style={styles.settingTitle}>Quiet hours</Text>
                  <Text style={type.small}>{push.quiet ? `${clockText(push.quietStart, timeFormat)} to ${clockText(push.quietEnd, timeFormat)}` : "No notifications at night."}</Text>
                </View>
                <Switch value={push.quiet} disabled={pushBusy} onValueChange={(on) => void changePush({ ...push, quiet: on })} trackColor={{ true: colors.primary }} accessibilityLabel="Quiet hours" />
              </View>
            ) : null}
            {push.enabled && push.quiet ? (
              <View style={[styles.line, styles.times]}>
                <TimeStep label="From" value={clockText(push.quietStart, timeFormat)} disabled={pushBusy} onStep={(by) => void changePush({ ...push, quietStart: wrapMinutes(push.quietStart + by) })} />
                <TimeStep label="To" value={clockText(push.quietEnd, timeFormat)} disabled={pushBusy} onStep={(by) => void changePush({ ...push, quietEnd: wrapMinutes(push.quietEnd + by) })} />
              </View>
            ) : null}
          </Card>
        </FadeInUp>

        <FadeInUp index={2}>
          <SectionLabel text="Appearance" />
          <Segmented
            label="Appearance"
            value={look}
            onChange={changeLook}
            options={[
              { value: "system", label: "System", icon: "phone-portrait-outline" },
              { value: "light", label: "Light", icon: "sunny-outline" },
              { value: "dark", label: "Dark", icon: "moon-outline" }
            ]}
          />
        </FadeInUp>

        <FadeInUp index={3}>
          <SectionLabel text="Account" />
          <Card style={styles.group}>
            <LinkRow icon="lock-closed-outline" label="Change password" onPress={() => router.push("/password")} />
            <LinkRow icon="help-circle-outline" label="Help" onPress={() => void Linking.openURL("https://www.riogps.com/help")} />
            <LinkRow icon="shield-checkmark-outline" label="Privacy policy" onPress={() => void Linking.openURL("https://www.riogps.com/privacy")} last />
          </Card>
        </FadeInUp>

        <FadeInUp index={4}>
          <SectionLabel text="Connection" />
          <Card style={styles.group}>
            <View style={styles.setting}>
              {check.state === "checking" ? <ActivityIndicator size="small" color={colors.primary} style={styles.checkIcon} /> : <View style={styles.checkIcon}><PulseDot size={10} color={check.state === "ok" ? colors.success : colors.danger} live={check.state === "ok"} /></View>}
              <View style={styles.flex}>
                <Text style={styles.settingTitle}>{check.state === "checking" ? "Checking connection" : check.state === "ok" ? "Connected" : "Not connected"}</Text>
                <Text style={type.small} numberOfLines={2}>{check.state === "failed" ? check.reason : check.state === "ok" ? `${SERVER} · checked at ${check.at}` : SERVER}</Text>
              </View>
              <Button variant="ghost" title="Check again" onPress={run} disabled={check.state === "checking"} />
            </View>
          </Card>
        </FadeInUp>

        <FadeInUp index={5} style={styles.end}>
          <Button variant="danger" title="Sign out" icon="log-out-outline" onPress={confirmSignOut} loading={leaving} />
          <Text style={styles.footer}>Version {Constants.expoConfig?.version ?? ""} · {SERVER}</Text>
        </FadeInUp>
      </ScrollView>
    </View>
  );
}

const SERVER = API_BASE_URL.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** A time of day with earlier / later buttons, in half-hour steps. */
function TimeStep({ label, value, disabled, onStep }: { label: string; value: string; disabled: boolean; onStep: (minutes: number) => void }) {
  return (
    <View style={styles.time}>
      <Text style={type.caption}>{label}</Text>
      <View style={styles.timeRow}>
        <PressableScale onPress={() => onStep(-30)} disabled={disabled} scaleTo={0.88} hitSlop={4} style={styles.timeButton} accessibilityRole="button" accessibilityLabel={`${label}: half an hour earlier`}>
          <Ionicons name="remove" size={18} color={colors.primary} />
        </PressableScale>
        <Text style={styles.timeValue} numberOfLines={1} accessibilityLabel={`${label} ${value}`}>{value}</Text>
        <PressableScale onPress={() => onStep(30)} disabled={disabled} scaleTo={0.88} hitSlop={4} style={styles.timeButton} accessibilityRole="button" accessibilityLabel={`${label}: half an hour later`}>
          <Ionicons name="add" size={18} color={colors.primary} />
        </PressableScale>
      </View>
    </View>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; last?: boolean }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.985} style={[styles.link, !last && styles.linkLine]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={size.icon} color={colors.mutedForeground} />
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.lg },
  profile: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: ink(colors.primary) },
  group: { paddingVertical: 0, paddingHorizontal: space.md },
  setting: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sub: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingLeft: size.icon + space.md },
  settingTitle: { fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  times: { flexDirection: "row", gap: space.lg, paddingVertical: space.md },
  time: { flex: 1, gap: 4 },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.muted, borderRadius: radius.lg, padding: 4 },
  timeButton: { width: 36, height: 36, borderRadius: radius.md - 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  timeValue: { fontSize: font.body, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  link: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52 },
  linkLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  linkText: { flex: 1, fontSize: font.body, lineHeight: 20, fontWeight: "500", color: colors.foreground },
  checkIcon: { width: size.icon, alignItems: "center" },
  end: { gap: space.md },
  footer: { ...type.caption, textAlign: "center" }
});
