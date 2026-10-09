import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { FleetProvider } from "@/fleet/FleetProvider";
import { colors } from "@/theme";

// Keep the splash screen up until we know whether someone is signed in,
// so the login screen never flashes for a signed-in person.
void SplashScreen.preventAutoHideAsync();

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
        <Stack.Screen
          name="vehicle/[id]"
          options={{ headerShown: true, title: "Vehicle", headerBackTitle: "Back", headerStyle: { backgroundColor: colors.primaryDark }, headerTintColor: colors.primaryForeground }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
  // Fleet data is only loaded, and only kept, while someone is signed in.
  return signedIn ? <FleetProvider>{stack}</FleetProvider> : stack;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <Screens />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
