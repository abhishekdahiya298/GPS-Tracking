import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AlertsProvider } from "@/alerts/AlertsProvider";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { HeaderBackground } from "@/components/kit";
import { FleetProvider } from "@/fleet/FleetProvider";
import { UpdateGate } from "@/updates/UpdateGate";
import { colors } from "@/theme";

// Keep the splash screen up until we know whether someone is signed in,
// so the login screen never flashes for a signed-in person.
void SplashScreen.preventAutoHideAsync();

/** Screens opened on top of the tabs share one header style. */
const pushed = { headerShown: true, headerBackTitle: "Back", headerBackground: () => <HeaderBackground />, headerTintColor: colors.primaryForeground, headerTitleStyle: { fontWeight: "700" as const }, headerShadowVisible: false };

function Screens() {
  const { state } = useSession();
  const ready = state.status !== "loading";
  const signedIn = state.status === "signedIn";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicle/[id]" options={{ ...pushed, title: "Vehicle" }} />
        <Stack.Screen name="trips/[id]" options={{ ...pushed, title: "Trips" }} />
        <Stack.Screen name="trip" options={{ ...pushed, title: "Trip" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
  // Fleet and alert data are only loaded, and only kept, while someone is signed in.
  return signedIn ? (
    <FleetProvider>
      <AlertsProvider>{stack}</AlertsProvider>
    </FleetProvider>
  ) : (
    stack
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* Before anything else: an app version the server no longer supports can't be used. */}
      <UpdateGate>
        <SessionProvider>
          <Screens />
        </SessionProvider>
      </UpdateGate>
    </SafeAreaProvider>
  );
}
