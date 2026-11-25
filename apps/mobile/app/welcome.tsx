import { useRouter } from "expo-router";
import { Text } from "react-native";
import { AuthShell, LinkCard } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { colors, themed } from "@/theme";

/** W0: the first screen. Create a free account, sign in, or join as a driver. */
export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <AuthShell
      title="Everything you move, live"
      tagline="Trucks, trailers, drivers and loads on one map."
      footer="Terms and Privacy policy apply · app.riogps.com"
      below={<LinkCard icon="car-outline" color="#a3470a" soft="#fcd9b2" title="Driving for a company?" detail="Join with your invite link or phone" onPress={() => router.push("/driver")} />}
    >
      <Button title="Create free account" icon="sparkles-outline" onPress={() => router.push("/signup")} />
      <Button title="Sign in" icon="log-in-outline" variant="outline" onPress={() => router.push("/login")} />
      <Text style={styles.note}>Free for 2 trucks and 2 drivers. No card.</Text>
    </AuthShell>
  );
}

const styles = themed(() => ({
  note: { fontSize: 13, textAlign: "center", color: colors.mutedForeground }
}));
