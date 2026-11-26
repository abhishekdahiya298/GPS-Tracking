import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { driver, type DriverCompany } from "@/driver/api";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { ago } from "@/driver/model";
import { driverStyles as ds, Pill } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

/** R7 / R4: the companies the driver works for (who sees them), requests waiting, Leave. */
export default function DriverCompanies() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useDriverSession();
  const data = useDriverData();
  const [busy, setBusy] = useState<string | null>(null);
  if (session.state.status !== "signedIn") return null;
  const { me } = session.state;
  const independent = me.link === "self";
  const working = data.companies.length || independent ? data.companies : [{ id: me.driver.id, company: me.company, link: me.link === "self" || !me.link ? "active" : me.link, since: new Date().toISOString(), vehicle: me.vehicle ? { name: me.vehicle.name, licensePlate: me.vehicle.licensePlate } : null, current: true } satisfies DriverCompany];

  const leave = (c: DriverCompany) => {
    const last = working.filter((w) => w.link === "active").length <= 1;
    Alert.alert(`Leave ${c.company.name}?`, last ? `${c.company.name} stops seeing your location and you'll be signed out.` : `${c.company.name} stops seeing your location and can't send you loads. Other companies keep seeing you.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          setBusy(c.id);
          try {
            const r = await driver.leave(c.id);
            if (r.signedOut) return void (await session.forget());
            await session.refresh();
            await data.refresh();
            if (r.movedTo) Alert.alert("Done", `You left ${c.company.name}. You're now signed in with ${r.movedTo.name}.`);
          } catch (err) {
            Alert.alert("Couldn't leave", err instanceof Error ? err.message : "Try again in a moment.");
          } finally {
            setBusy(null);
          }
        }
      }
    ]);
  };

  return (
    <ScrollView style={ds.screen} contentContainerStyle={[ds.body, { paddingTop: space.lg, paddingBottom: insets.bottom + space.xl }]}>
      {data.requests.length ? (
        <>
          <Text style={ds.section}>WAITING FOR YOUR ANSWER</Text>
          {data.requests.map((r) => (
            <View key={r.id} style={styles.card}>
              <View style={styles.top}>
                <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="business-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name}>{r.company.name}</Text>
                  <Text style={styles.sub}>Wants to add you · {ago(r.askedAt)}</Text>
                </View>
              </View>
              <View style={styles.btns}>
                <Pressable style={[styles.btn, styles.btnNo]} onPress={() => void data.respond(r.id, false).catch((e: Error) => Alert.alert("Couldn't send that", e.message))} accessibilityRole="button">
                  <Text style={styles.btnNoText}>Decline</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnYes]} onPress={() => void data.respond(r.id, true).catch((e: Error) => Alert.alert("Couldn't send that", e.message))} accessibilityRole="button">
                  <Text style={styles.btnYesText}>Accept</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}

      <Text style={ds.section}>WHO SEES MY LOCATION</Text>
      {working.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.name}>No company yet</Text>
          <Text style={styles.sub}>Nobody sees your location all the time. When a carrier adds your number, it shows above for you to accept. Loads you accept are shared for that load only.</Text>
        </View>
      ) : null}
      {working.map((c) => {
        const sharing = c.link === "active";
        return (
          <View key={c.id} style={styles.card}>
            <View style={styles.top}>
              <View style={[styles.logo, { backgroundColor: sharing ? "#c8e8d2" : "#fcd9b2" }]}>
                <Ionicons name="business" size={20} color={sharing ? "#136c35" : "#a3470a"} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>{c.company.name}</Text>
                <Text style={styles.sub}>
                  {sharing ? `Since ${new Date(c.since).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : "Not accepted yet"}
                  {c.vehicle ? ` · ${c.vehicle.name}` : ""}
                </Text>
              </View>
              <Pill text={sharing ? "Sees you" : "Doesn't see you"} color={sharing ? "#136c35" : "#a3470a"} soft={sharing ? "#c8e8d2" : "#fcd9b2"} />
            </View>
            <View style={styles.btns}>
              {c.company.phone ? (
                <Pressable style={[styles.btn, styles.btnNo]} onPress={() => void Linking.openURL(`tel:${c.company.phone}`)} accessibilityRole="button">
                  <Ionicons name="call-outline" size={16} color={colors.foreground} />
                  <Text style={styles.btnNoText}>Call</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.btn, styles.btnNo]} disabled={busy === c.id} onPress={() => leave(c)} accessibilityRole="button" accessibilityLabel={`Leave ${c.company.name}`}>
                {busy === c.id ? <ActivityIndicator color={colors.danger} /> : <Text style={[styles.btnNoText, { color: colors.danger }]}>Leave</Text>}
              </Pressable>
            </View>
          </View>
        );
      })}
      <Text style={styles.fine}>Only companies you accept see your location, and only while you&apos;re signed in. A company that adds your number shows up above until you answer.</Text>
      <Pressable onPress={() => router.push("/driver/reports")} style={styles.link} accessibilityRole="button">
        <Ionicons name="bar-chart-outline" size={16} color={colors.primary} />
        <Text style={styles.linkText}>See how much you drove</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  card: { gap: space.md, padding: 14, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  logo: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  sub: { fontSize: 12.5, color: colors.mutedForeground },
  btns: { flexDirection: "row", gap: space.sm },
  btn: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  btnNo: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  btnNoText: { fontSize: 14.5, fontWeight: "700", color: colors.foreground },
  btnYes: { backgroundColor: "#136c35" },
  btnYesText: { fontSize: 14.5, fontWeight: "700", color: "#ffffff" },
  fine: { fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground },
  link: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44 },
  linkText: { fontSize: 14, fontWeight: "600", color: colors.primary }
}));
