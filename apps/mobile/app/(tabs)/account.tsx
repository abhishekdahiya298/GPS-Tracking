import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, api, type ReadyResponse } from "@/api";
import { useSession } from "@/auth/SessionProvider";
import { Button } from "@/components/ui";
import { API_BASE_URL } from "@/config";
import { colors, font, radius, space } from "@/theme";

type Check = { state: "checking" } | { state: "ok"; at: string } | { state: "failed"; reason: string };

export default function AccountScreen() {
  const { state, signOut } = useSession();
  const user = state.status === "signedIn" ? state.user : null;
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [leaving, setLeaving] = useState(false);

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
      <View style={[styles.card, styles.person]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.value} numberOfLines={1}>{user?.name || "Signed in"}</Text>
          {user?.email ? <Text style={styles.label} numberOfLines={1}>{user.email}</Text> : null}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Server</Text>
        <Text style={styles.value}>{API_BASE_URL.replace(/^https?:\/\//, "")}</Text>
        <View style={styles.row}>
          {check.state === "checking" ? <ActivityIndicator color={colors.primary} /> : <View style={[styles.dot, { backgroundColor: check.state === "ok" ? colors.success : colors.danger }]} />}
          <Text style={styles.status}>
            {check.state === "checking" ? "Checking connection" : check.state === "ok" ? `Connected, checked at ${check.at}` : check.reason}
          </Text>
        </View>
        <Button variant="ghost" title="Check again" onPress={run} />
      </View>

      <Button variant="danger" title="Sign out" onPress={confirmSignOut} loading={leaving} />
      <Text style={styles.footer}>RIO GPS {Constants.expoConfig?.version ?? ""}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
  flex: { flex: 1 },
  card: { backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  person: { flexDirection: "row", alignItems: "center", gap: space.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: font.title, fontWeight: "700" },
  label: { fontSize: font.small, color: colors.mutedForeground, marginTop: 2 },
  value: { fontSize: font.title, fontWeight: "600", color: colors.foreground },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md, minHeight: 24 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { flex: 1, fontSize: font.body, color: colors.foreground },
  footer: { textAlign: "center", fontSize: font.small, color: colors.mutedForeground }
});
