import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, api, type ReadyResponse } from "@/api";
import { useSession } from "@/auth/SessionProvider";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Card } from "@/components/kit";
import { FadeInUp, PulseDot } from "@/components/motion";
import { Button } from "@/components/ui";
import { API_BASE_URL } from "@/config";
import { colors, elevation, font, gradient, space } from "@/theme";

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
        <Button variant="danger" title="Sign out" icon="log-out-outline" onPress={confirmSignOut} loading={leaving} />
      </FadeInUp>
      <Text style={styles.footer}>RIO GPS {Constants.expoConfig?.version ?? ""}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
