import { Ionicons } from "@expo/vector-icons";
import * as Battery from "expo-battery";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { DriverRequest } from "@/driver/api";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { ago, currentLoad, greeting } from "@/driver/model";
import { DriverHeader, driverStyles as ds, Group, LoadCard, Row } from "@/driver/parts";
import { colors, elevation, space, themed } from "@/theme";

/** Today (D3B, D3, D4, D12): the driver is on the map with or without a load. */
export default function Today() {
  const router = useRouter();
  const { state } = useDriverSession();
  const data = useDriverData();
  const [refreshing, setRefreshing] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
  useEffect(() => {
    void Battery.getBatteryLevelAsync()
      .then((l) => setBattery(l >= 0 ? Math.round(l * 100) : null))
      .catch(() => undefined);
  }, [data.lastSentAt]);
  if (state.status !== "signedIn") return null;
  const { me } = state;
  const first = me.driver.name.split(/\s+/)[0] ?? me.driver.name;
  const loads = data.loads ?? [];
  const open = loads.filter((l) => l.status !== "delivered");
  const now = currentLoad(open);
  const later = open.filter((l) => l.id !== now?.id);
  const off = data.permission === "off" || !data.locationEnabled;
  const notAlways = !off && data.permission === "while_using";
  const asked = me.locationRequest && (off || notAlways);

  return (
    <View style={ds.screen}>
      <DriverHeader company={me.company.name} />
      <ScrollView
        contentContainerStyle={ds.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await data.refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        <View>
          <Text style={ds.h1} accessibilityRole="header">
            {greeting()}, {first}
          </Text>
          <Text style={ds.sub}>
            {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {open.length ? `${open.length} load${open.length === 1 ? "" : "s"}` : "no loads yet"}
          </Text>
        </View>

        {data.requests.map((r) => (
          <RequestCard key={r.id} r={r} onAnswer={data.respond} />
        ))}

        {off ? (
          <View style={[styles.alert, styles.alertRed]}>
            <View style={[styles.edge, { backgroundColor: "#9c1818" }]} />
            <View style={styles.alertTop}>
              <View style={[styles.alertIcon, { backgroundColor: "#f4bcbc" }]}>
                <Ionicons name="location-outline" size={24} color="#9c1818" />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.alertTitle, { color: "#9c1818" }]}>{asked ? "Dispatch is asking for your location" : "Location is off"}</Text>
                <Text style={styles.alertSub}>{asked ? `${me.locationRequest!.from ?? "Your company"} · ${ago(me.locationRequest!.at)}` : `${me.company.name} can't see where you are.`}</Text>
              </View>
            </View>
            <Text style={styles.alertText}>Your loads can't update and dispatch can't see you. Turn location back on and set it to Always.</Text>
            <Pressable onPress={data.openLocationSettings} style={styles.greenBtn} accessibilityRole="button">
              <Ionicons name="location" size={18} color="#ffffff" />
              <Text style={styles.greenText}>Turn on location</Text>
            </Pressable>
          </View>
        ) : notAlways ? (
          <View style={[styles.alert, styles.alertAmber]}>
            <View style={[styles.edge, { backgroundColor: "#a3470a" }]} />
            <Text style={[styles.alertTitle, { color: "#a3470a" }]}>Set location to Always</Text>
            <Text style={styles.alertText}>Right now sharing stops when the app is closed. In Settings, choose Location › Always.</Text>
            <Pressable onPress={data.openLocationSettings} style={[styles.greenBtn, { backgroundColor: "#a3470a" }]} accessibilityRole="button">
              <Text style={styles.greenText}>Open settings</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.pulse}>
                <View style={styles.pulseDot} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.heroTitle}>You&apos;re on the map</Text>
                <Text style={styles.heroSub}>
                  {me.companiesSharing === 0 ? "No company sees you until you accept" : `Sharing with ${(me.companiesSharing ?? 1) > 1 ? `${me.companiesSharing} companies` : me.company.name}`}
                  {battery != null ? ` · battery ${battery}%` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.facts}>
              <Fact value={me.vehicle?.name ?? "No truck"} label="Your truck" />
              <Fact value={ago(data.lastSentAt)} label="Last update" />
              <Fact value="Always" label="While signed in" />
            </View>
            <Pressable onPress={() => router.push("/me")} style={styles.heroLink} accessibilityRole="button">
              <Ionicons name="shield-checkmark-outline" size={16} color="#ffffff" />
              <Text style={styles.heroLinkText}>What&apos;s shared and who sees it</Text>
            </Pressable>
          </View>
        )}

        {now ? (
          <LoadCard load={now} dispatchPhone={me.company.phone} onPress={() => router.push("/loads")} />
        ) : data.loads ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="cube-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No load assigned yet</Text>
            <Text style={styles.emptyText}>Dispatch can still see where you are. When they give you a load, it shows here and you get a notification.</Text>
          </View>
        ) : null}

        {later.length ? (
          <>
            <Text style={ds.section}>UP NEXT</Text>
            {later.slice(0, 3).map((l) => (
              <LoadCard key={l.id} load={l} onPress={() => router.push("/loads")} />
            ))}
          </>
        ) : null}

        <Group>
          {me.company.phone ? <Row icon="call-outline" color="#136c35" soft="#c8e8d2" title="Call dispatch" detail={me.company.phone} onPress={() => void Linking.openURL(`tel:${me.company.phone}`)} /> : null}
          <Row icon="car-outline" color="#1d4ed8" soft="#dbe4f8" title={me.vehicle?.name ?? "No truck assigned"} detail={me.vehicle ? me.vehicle.licensePlate ?? "Your truck today" : "Your company assigns your truck"} />
        </Group>
      </ScrollView>
    </View>
  );
}

/** R1: a company added the driver's number. Nothing is shared with it until the driver accepts. */
function RequestCard({ r, onAnswer }: { r: DriverRequest; onAnswer: (id: string, accept: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const answer = async (accept: boolean) => {
    setBusy(accept ? "yes" : "no");
    try {
      await onAnswer(r.id, accept);
    } catch (err) {
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={styles.req}>
      <View style={[styles.edge, { backgroundColor: colors.primary }]} />
      <View style={styles.alertTop}>
        <View style={[styles.alertIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="business-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.reqTitle}>{r.company.name} wants to add you</Text>
          <Text style={styles.alertSub}>Asked {ago(r.askedAt)}</Text>
        </View>
      </View>
      <Text style={styles.reqText}>If you accept, {r.company.name} can see your location while you&apos;re signed in and send you loads. You can leave any time in Account.</Text>
      <View style={styles.reqBtns}>
        <Pressable onPress={() => void answer(false)} disabled={!!busy} style={[styles.reqBtn, styles.reqNo]} accessibilityRole="button" accessibilityLabel={`Decline ${r.company.name}`}>
          {busy === "no" ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.reqNoText}>Decline</Text>}
        </Pressable>
        <Pressable onPress={() => void answer(true)} disabled={!!busy} style={[styles.reqBtn, styles.reqYes]} accessibilityRole="button" accessibilityLabel={`Accept ${r.company.name}`}>
          {busy === "yes" ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.greenText}>Accept</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  hero: { gap: space.md, padding: 16, borderRadius: 20, backgroundColor: "#13286b", ...elevation.md },
  heroTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  pulse: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(74,222,128,0.18)", alignItems: "center", justifyContent: "center" },
  pulseDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#4ade80" },
  heroTitle: { fontSize: 18, fontWeight: "700", color: "#ffffff" },
  heroSub: { fontSize: 13, color: "rgba(255,255,255,0.8)" },
  facts: { flexDirection: "row", gap: space.sm },
  fact: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)" },
  factValue: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
  factLabel: { fontSize: 11.5, color: "rgba(255,255,255,0.75)" },
  heroLink: { height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  heroLinkText: { fontSize: 13.5, fontWeight: "600", color: "#ffffff" },
  alert: { position: "relative", gap: space.md, padding: 16, paddingLeft: 20, borderRadius: 20, overflow: "hidden", borderWidth: 1.5 },
  alertRed: { backgroundColor: "#fdecec", borderColor: "#e79a9a" },
  alertAmber: { backgroundColor: "#fff4e5", borderColor: "#f5c08d" },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6 },
  alertTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  alertIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: 19, fontWeight: "700" },
  alertSub: { fontSize: 13, color: "#3f4b5e" },
  alertText: { fontSize: 14, lineHeight: 20, color: "#0f172a" },
  greenBtn: { height: 50, borderRadius: 14, backgroundColor: "#136c35", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  greenText: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
  req: { position: "relative", gap: space.md, padding: 16, paddingLeft: 20, borderRadius: 20, overflow: "hidden", borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.background, ...elevation.md },
  reqTitle: { fontSize: 17, fontWeight: "700", color: colors.foreground },
  reqText: { fontSize: 14, lineHeight: 20, color: colors.foreground },
  reqBtns: { flexDirection: "row", gap: space.sm },
  reqBtn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  reqNo: { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border },
  reqNoText: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  reqYes: { backgroundColor: "#136c35" },
  empty: { alignItems: "center", gap: 8, padding: 18, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  emptyText: { fontSize: 13, lineHeight: 18, textAlign: "center", color: colors.mutedForeground, maxWidth: 290 }
}));
