import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useDriverSession } from "@/driver/DriverSession";
import { colors, space, themed } from "@/theme";

/** D15: the company signed the driver out (or made them inactive). Nothing is sent from the phone. */
export default function DriverEnded() {
  const router = useRouter();
  const { state, dismissEnded } = useDriverSession();
  const company = state.status === "ended" ? state.company : null;
  return (
    <AuthShell title="You're signed out" tagline={`${company ?? "Your company"} signed you out of the app. Location sharing has stopped.`} footer={null}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="log-out-outline" size={22} color="#4b5563" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Not sharing anymore</Text>
          <Text style={styles.sub}>Nothing is sent from this phone.</Text>
        </View>
      </View>
      <Button
        title="Sign in again"
        onPress={() => {
          dismissEnded();
          router.replace("/driver");
        }}
      />
      <Text style={styles.fine}>Changed jobs? You can delete the app. Your history stays with the company you drove for.</Text>
    </AuthShell>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#d6dbe3", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  sub: { fontSize: 13, color: colors.mutedForeground },
  fine: { fontSize: 12.5, textAlign: "center", color: colors.mutedForeground }
}));
