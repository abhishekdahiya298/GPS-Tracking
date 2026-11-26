import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { DriverHeader, driverStyles as ds, Group, Pill, Row } from "@/driver/parts";
import { notificationsAllowed, registerDriverPush } from "@/driver/push";
import { colors, space, themed } from "@/theme";

/** Account (D7): who I am, what's shared and who sees it, notifications, sign out. */
export default function DriverAccount() {
  const router = useRouter();
  const { state, signOut } = useDriverSession();
  const data = useDriverData();
  const [notify, setNotify] = useState<boolean | null>(null);
  useEffect(() => {
    void notificationsAllowed().then(setNotify);
  }, []);
  if (state.status !== "signedIn") return null;
  const { me } = state;
  const sharing = data.permission !== "off" && data.locationEnabled;
  const initials = me.driver.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <View style={ds.screen}>
      <DriverHeader company={me.company.name} />
      <ScrollView contentContainerStyle={ds.body}>
        <Text style={ds.h1} accessibilityRole="header">
          Account
        </Text>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{me.driver.name}</Text>
            <Text style={styles.sub}>{data.companies.length > 1 ? `Driver · ${data.companies.length} companies` : me.link === "self" && !data.companies.length ? "Independent driver" : `Driver · ${data.companies[0]?.company.name ?? me.company.name}`}</Text>
            {me.driver.phone ? <Text style={styles.sub}>{me.driver.phone}</Text> : null}
          </View>
          <Pill text={sharing ? "Sharing" : "Off"} color={sharing ? "#136c35" : "#ad1f1f"} soft={sharing ? "#c8e8d2" : "#f6cdcd"} />
        </View>

        <View style={styles.privacy}>
          <View style={styles.privacyTop}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text style={styles.privacyTitle}>Your location and privacy</Text>
          </View>
          <View style={styles.facts}>
            <View style={styles.fact}>
              <Text style={styles.factValue}>Always</Text>
              <Text style={styles.factLabel}>While signed in</Text>
            </View>
            <View style={styles.fact}>
              <Text style={styles.factValue} numberOfLines={1}>
                {me.companiesSharing === 0 ? "Only loads you accept" : (me.companiesSharing ?? 1) > 1 ? `${me.companiesSharing} companies` : me.company.name}
              </Text>
              <Text style={styles.factLabel}>Who sees it</Text>
            </View>
          </View>
          <Text style={styles.privacyText}>{me.sharing.note} Signing out stops sharing, and your company is told.</Text>
        </View>

        <Text style={ds.section}>MY RECORD</Text>
        <Group>
          <Row icon="person-circle-outline" color="#133a9e" soft="#dbe4f8" title="Edit profile" detail={[me.driver.email, me.driver.licenseNumber ? `Licence ${me.driver.licenseNumber}` : null].filter(Boolean).join(" · ") || "Name, email and licence"} onPress={() => router.push("/driver/profile")} />
          <Row icon="bar-chart-outline" color="#136c35" soft="#c8e8d2" title="My reports" detail="How much you drove today, this week and this month" onPress={() => router.push("/driver/reports")} />
          <Row
            icon="business-outline"
            color="#6d28d9"
            soft="#e6dcfb"
            title="Companies I work for"
            detail={data.requests.length ? `${data.requests.length} waiting for your answer` : data.companies.length ? data.companies.map((c) => c.company.name).join(", ") : me.link === "self" ? "None yet" : me.company.name}
            onPress={() => router.push("/driver/record")}
          />
        </Group>

        <Text style={ds.section}>DRIVING</Text>
        <Group>
          <Row icon="car-outline" color="#1d4ed8" soft="#dbe4f8" title={me.vehicle?.name ?? "No truck assigned"} detail={me.vehicle?.licensePlate ?? "Your company assigns your truck"} />
          <Row icon="location-outline" color={sharing ? "#136c35" : "#ad1f1f"} soft={sharing ? "#c8e8d2" : "#f6cdcd"} title="Location" detail={data.permission === "always" && data.locationEnabled ? "Always: works with the screen off" : data.permission === "while_using" ? "While using the app: change to Always" : "Off: turn it on in Settings"} onPress={data.openLocationSettings} />
          <Row
            icon="notifications-outline"
            color="#a3470a"
            soft="#fcd9b2"
            title="Notifications"
            detail={notify ? "On: loads and requests from dispatch" : "Off: dispatch can't reach you"}
            onPress={async () => {
              const ok = await registerDriverPush(true);
              setNotify(ok);
              if (!ok) void Linking.openSettings();
            }}
          />
        </Group>

        <Text style={ds.section}>HELP</Text>
        <Group>
          {me.company.phone ? <Row icon="call-outline" color="#136c35" soft="#c8e8d2" title="Call dispatch" detail={me.company.phone} onPress={() => void Linking.openURL(`tel:${me.company.phone}`)} /> : null}
          <Row
            icon="log-out-outline"
            color="#4b5563"
            soft="#d6dbe3"
            title="Sign out"
            detail="Stops sharing; your company is told"
            onPress={() =>
              Alert.alert("Sign out?", (me.companiesSharing ?? 1) > 1 ? "Location sharing with every company stops." : `Location sharing with ${me.company.name} stops.`, [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: () => void signOut() }
              ])
            }
          />
        </Group>
        <Text style={styles.version}>Version {Constants.expoConfig?.version ?? ""}</Text>
      </ScrollView>
    </View>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  profile: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 14, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#133a9e", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontSize: 18, fontWeight: "800" },
  name: { fontSize: 17, fontWeight: "700", color: colors.foreground },
  sub: { fontSize: 13, color: colors.mutedForeground },
  privacy: { gap: space.md, padding: 14, borderRadius: 16, backgroundColor: colors.successSoft },
  privacyTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  privacyTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  facts: { flexDirection: "row", gap: space.sm },
  fact: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.background, alignItems: "center" },
  factValue: { fontSize: 15, fontWeight: "800", color: colors.success },
  factLabel: { fontSize: 12, color: colors.mutedForeground },
  privacyText: { fontSize: 13, lineHeight: 18, color: colors.foreground },
  version: { fontSize: 12, textAlign: "center", color: colors.mutedForeground }
}));
