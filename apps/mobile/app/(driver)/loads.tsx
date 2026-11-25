import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
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
          <LoadCard key={l.id} load={l} expanded={open === l.id} dispatchPhone={state.me.company.phone} onPress={() => setOpen(open === l.id ? null : l.id)} />
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
  empty: { alignItems: "center", gap: space.sm, padding: space.xl },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center", color: colors.mutedForeground },
  tip: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: 12, borderRadius: 14, backgroundColor: colors.successSoft },
  tipText: { flex: 1, fontSize: 13, color: colors.foreground }
}));
