import { KM_PER_MILE } from "@rio-gps/core/units";
import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, api, type ReadyResponse } from "@/api";
import { API_BASE_URL } from "@/config";
import { colors, font, radius, space } from "@/theme";

type Check = { state: "checking" } | { state: "ok"; at: string } | { state: "failed"; reason: string };

/**
 * Until sign-in exists, this tab proves the two things the rest of the app depends on:
 * the phone can reach the server, and code shared with the web app loads.
 */
export default function AccountScreen() {
  const [check, setCheck] = useState<Check>({ state: "checking" });

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

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.label}>Server</Text>
        <Text style={styles.value}>{API_BASE_URL.replace(/^https?:\/\//, "")}</Text>
        <View style={styles.row}>
          {check.state === "checking" ? <ActivityIndicator color={colors.primary} /> : <View style={[styles.dot, { backgroundColor: check.state === "ok" ? colors.success : colors.danger }]} />}
          <Text style={styles.status}>
            {check.state === "checking" ? "Checking connection" : check.state === "ok" ? `Connected, checked at ${check.at}` : check.reason}
          </Text>
        </View>
        <Pressable onPress={run} style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.primaryDark }]} accessibilityRole="button">
          <Text style={styles.buttonText}>Check again</Text>
        </Pressable>
      </View>
      <Text style={styles.footer}>
        RIO GPS {Constants.expoConfig?.version ?? ""} · shared code loaded ({KM_PER_MILE} km per mile)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.lg, backgroundColor: colors.canvas },
  card: { backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  label: { fontSize: font.small, color: colors.mutedForeground, marginBottom: space.xs },
  value: { fontSize: font.title, fontWeight: "600", color: colors.foreground },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md, minHeight: 24 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { flex: 1, fontSize: font.body, color: colors.foreground },
  button: { marginTop: space.lg, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: space.md, alignItems: "center" },
  buttonText: { color: colors.primaryForeground, fontSize: font.body, fontWeight: "600" },
  footer: { marginTop: space.lg, textAlign: "center", fontSize: font.small, color: colors.mutedForeground }
});
