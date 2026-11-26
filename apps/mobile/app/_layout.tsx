import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AlertsProvider } from "@/alerts/AlertsProvider";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { DriverDataProvider } from "@/driver/DriverData";
import { DriverSessionProvider, useDriverSession } from "@/driver/DriverSession";
// Defines the background location task; it must exist before the phone wakes the app for it.
import "@/driver/tracking";
import { FleetProvider } from "@/fleet/FleetProvider";
import { routeForNotification } from "@/push/model";
import { refreshPushRegistration } from "@/push/service";
import { UpdateGate } from "@/updates/UpdateGate";
import { applyLook, colors, isDark, lookVersion, onLookChange, themeChoice } from "@/theme";

// Keep the splash screen up until we know whether someone is signed in,
// so the login screen never flashes for a signed-in person.
void SplashScreen.preventAutoHideAsync();

// A look picked in Account also applies to the phone's own pieces: keyboard, alerts, pickers.
if (themeChoice !== "system") Appearance.setColorScheme(themeChoice);

/** Screens opened on top of the tabs share one plain header: back arrow, centred title, no shadow. */
const pushedOptions = () => ({
  headerShown: true,
  headerBackButtonDisplayMode: "minimal" as const,
  headerTitleAlign: "center" as const,
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.foreground,
  headerTitleStyle: { fontWeight: "600" as const, fontSize: 17 },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.canvas }
});

function Screens() {
  const { state } = useSession();
  const driver = useDriverSession();
  const ds = driver.state;
  const ready = state.status !== "loading" && ds.status !== "loading";
  // A phone is signed in either as a driver (driver tabs) or as an owner/dispatcher (fleet tabs).
  const driverIn = ds.status === "signedIn";
  const setupDone = ds.status === "signedIn" && ds.setupDone;
  const ended = ds.status === "ended";
  const signedIn = state.status === "signedIn" && !driverIn && !ended;
  const signedOut = !signedIn && !driverIn && !ended;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Signed in: keep this phone's notification registration fresh.
  useEffect(() => {
    if (signedIn) void refreshPushRegistration();
  }, [signedIn]);

  // A tapped notification (also the one that opened the app): alerts for owners; for drivers,
  // the company's "turn on location" request (D14) or a sign-out notice.
  const router = useRouter();
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!tapped) return;
    const data = (tapped.notification.request.content.data ?? {}) as Record<string, unknown>;
    if (driverIn) {
      if (data.type === "driver_request" || data.type === "load_request") router.navigate("/today");
      else if (data.type === "driver_removed") router.navigate({ pathname: "/driver/removed", params: { company: String(data.company ?? "") } });
      else if (data.type === "location_request") router.navigate({ pathname: "/driver/request", params: { from: String(data.from ?? ""), message: String(data.message ?? ""), at: String(data.at ?? "") } });
      else void driver.refresh();
    } else if (signedIn) {
      const route = routeForNotification(data);
      if (route) router.navigate(route);
    } else return;
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [signedIn, driverIn, tapped, router]);

  // A request or sign-out notice arriving while a driver has the app open.
  useEffect(() => {
    if (!driverIn) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      if (data.type === "driver_signed_out") void driver.refresh();
      else if (data.type === "driver_removed") {
        void driver.refresh();
        router.navigate({ pathname: "/driver/removed", params: { company: String(data.company ?? "") } });
      }
    });
    return () => sub.remove();
  }, [driverIn]);

  // The look changed (Account, or the phone went dark): draw every screen again in the new
  // colours, at once and without restarting the app. Session and fleet data stay as they are.
  const look = useSyncExternalStore(onLookChange, lookVersion);

  if (!ready) return null;
  const pushed = pushedOptions();
  const stack = (
    <Stack key={look} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicle/[id]" options={{ ...pushed, title: "Vehicle" }} />
        <Stack.Screen name="trips/[id]" options={{ ...pushed, title: "Trips" }} />
        <Stack.Screen name="trip" options={{ ...pushed, title: "Trip" }} />
        <Stack.Screen name="alert/[id]" options={{ ...pushed, title: "Alert" }} />
        <Stack.Screen name="password" options={{ ...pushed, title: "Change password" }} />
      </Stack.Protected>
      <Stack.Protected guard={driverIn && setupDone}>
        <Stack.Screen name="(driver)" />
        <Stack.Screen name="driver/request" options={{ presentation: "modal" }} />
        <Stack.Screen name="driver/record" options={{ ...pushed, title: "Companies" }} />
        <Stack.Screen name="driver/profile" options={{ ...pushed, title: "Edit profile" }} />
        <Stack.Screen name="driver/reports" options={{ ...pushed, title: "My reports" }} />
        <Stack.Screen name="driver/removed" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={driverIn && !setupDone}>
        <Stack.Screen name="driver/setup" />
      </Stack.Protected>
      <Stack.Protected guard={ended}>
        <Stack.Screen name="driver/ended" />
      </Stack.Protected>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot" />
        <Stack.Screen name="signup/index" />
        <Stack.Screen name="signup/details" />
        <Stack.Screen name="signup/code" />
        <Stack.Screen name="driver/index" />
      </Stack.Protected>
    </Stack>
  );
  // Fleet and alert data are only loaded, and only kept, while someone is signed in.
  if (driverIn) return <DriverDataProvider>{stack}</DriverDataProvider>;
  return signedIn ? (
    <FleetProvider>
      <AlertsProvider>{stack}</AlertsProvider>
    </FleetProvider>
  ) : (
    stack
  );
}

export default function RootLayout() {
  // "Same as phone": when the phone switches between light and dark while the app is open,
  // every screen (and the map) changes together, straight away.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (themeChoice === "system") applyLook("system", colorScheme);
    });
    return () => sub.remove();
  }, []);
  useSyncExternalStore(onLookChange, lookVersion);
  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? "light" : "dark"} />
      {/* Before anything else: an app version the server no longer supports can't be used. */}
      <UpdateGate>
        <SessionProvider>
          <DriverSessionProvider>
            <Screens />
          </DriverSessionProvider>
        </SessionProvider>
      </UpdateGate>
    </SafeAreaProvider>
  );
}
