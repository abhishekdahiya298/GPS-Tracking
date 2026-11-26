import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Segmented } from "@/components/kit";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { DriverHeader, driverStyles as ds, LoadCard } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

/** Loads (D9, D5): open loads with both stops and Navigate; delivered ones from the last day. */
export default function Loads() {
  const { state } = useDriverSession();
  const data = useDriverData();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  if (state.status !== "signedIn") return null;
  const all = data.loads ?? [];
  const list = all.filter((l) => (tab === "done" ? l.status === "delivered" : l.status !== "delivered"));
  const openCount = all.filter((l) => l.status !== "delivered").length;

  return (
    <View style={ds.screen}>
      <DriverHeader company={state.me.company.name} />
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
        <Text style={ds.h1} accessibilityRole="header">
          Loads
        </Text>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: `Open ${openCount}` },
            { value: "done", label: "Done" }
          ]}
        />
        {data.loadsError && !data.loads ? <Text style={styles.note}>Can&apos;t load your loads right now. Pull down to try again.</Text> : null}
        {list.map((l) => (
          <View key={l.id} style={styles.item}>
            <LoadCard load={l} expanded={open === l.id} dispatchPhone={l.from?.phone ?? state.me.company.phone} onPress={() => setOpen(open === l.id ? null : l.id)} />
            {l.kind === "outside" && l.byPhone && l.status !== "delivered" ? (
              <View style={[styles.share, l.paused && styles.sharePaused]}>
                <Ionicons name={l.paused ? "pause-circle" : "radio-button-on"} size={18} color={l.paused ? "#a3470a" : colors.success} />
                <Text style={styles.shareText}>{l.paused ? `Paused: ${l.from?.name ?? "The company"} can't see you for this load.` : `${l.from?.name ?? "The company"} sees you for this load only.`}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.shareBtn}
                  onPress={() =>
                    l.paused
                      ? void data.answerLoad(l.id, "resume").catch((e: Error) => Alert.alert("Couldn't resume", e.message))
                      : Alert.alert(`Stop sharing for ${l.reference}?`, `${l.from?.name ?? "The company"} is told you stopped. You can resume any time.`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Stop sharing", style: "destructive", onPress: () => void data.answerLoad(l.id, "stop").catch((e: Error) => Alert.alert("Couldn't stop", e.message)) }
                        ])
                  }
                >
                  <Text style={styles.shareBtnText}>{l.paused ? "Resume" : "Stop"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
        {data.loads && list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={28} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>{tab === "open" ? "No open loads. You're still on the map; new loads show here with a notification." : "Nothing delivered in the last day."}</Text>
          </View>
        ) : null}
        <View style={styles.tip}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
          <Text style={styles.tipText}>Arrived and left are marked for you at each stop from your location.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = themed(() => ({
  note: { fontSize: 13, color: colors.danger },
  item: { gap: 6 },
  share: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.successSoft },
  sharePaused: { backgroundColor: "#fff4e5" },
  shareText: { flex: 1, fontSize: 12.5, color: colors.foreground },
  shareBtn: { paddingHorizontal: 12, height: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  shareBtnText: { fontSize: 13, fontWeight: "700", color: colors.foreground },
  empty: { alignItems: "center", gap: space.sm, padding: space.xl },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center", color: colors.mutedForeground },
  tip: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: 12, borderRadius: 14, backgroundColor: colors.successSoft },
  tipText: { flex: 1, fontSize: 13, color: colors.foreground }
}));
