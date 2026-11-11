import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AlertsProvider } from "@/alerts/AlertsProvider";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { FleetProvider } from "@/fleet/FleetProvider";
import { routeForNotification } from "@/push/model";
import { refreshPushRegistration } from "@/push/service";
import { UpdateGate } from "@/updates/UpdateGate";
import { colors, isDark, themeChoice } from "@/theme";

// Keep the splash screen up until we know whether someone is signed in,
// so the login screen never flashes for a signed-in person.
void SplashScreen.preventAutoHideAsync();

// A look picked in Account also applies to the phone's own pieces: keyboard, alerts, pickers.
if (themeChoice !== "system") Appearance.setColorScheme(themeChoice);

/** Screens opened on top of the tabs share one plain header: back arrow, centred title, no shadow. */
const pushed = {
  headerShown: true,
  headerBackButtonDisplayMode: "minimal" as const,
  headerTitleAlign: "center" as const,
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.foreground,
  headerTitleStyle: { fontWeight: "600" as const, fontSize: 17 },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.canvas }
};

function Screens() {
  const { state } = useSession();
  const ready = state.status !== "loading";
  const signedIn = state.status === "signedIn";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Signed in: keep this phone's notification registration fresh.
  useEffect(() => {
    if (signedIn) void refreshPushRegistration();
  }, [signedIn]);

  // A tapped notification (also the one that opened the app) leads to the Alerts tab.
  const router = useRouter();
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!signedIn || !tapped) return;
    const route = routeForNotification(tapped.notification.request.content.data);
    if (route) router.navigate(route);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [signedIn, tapped, router]);

  if (!ready) return null;
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicle/[id]" options={{ ...pushed, title: "Vehicle" }} />
        <Stack.Screen name="trips/[id]" options={{ ...pushed, title: "Trips" }} />
        <Stack.Screen name="trip" options={{ ...pushed, title: "Trip" }} />
        <Stack.Screen name="password" options={{ ...pushed, title: "Change password" }} />
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
      <StatusBar style={isDark ? "light" : "dark"} />
      {/* Before anything else: an app version the server no longer supports can't be used. */}
      <UpdateGate>
        <SessionProvider>
          <Screens />
        </SessionProvider>
      </UpdateGate>
    </SafeAreaProvider>
  );
}
