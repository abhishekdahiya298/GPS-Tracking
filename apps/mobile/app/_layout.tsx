import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Animated, Appearance, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AlertsProvider } from "@/alerts/AlertsProvider";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { FleetProvider } from "@/fleet/FleetProvider";
import { routeForNotification } from "@/push/model";
import { refreshPushRegistration } from "@/push/service";
import { UpdateGate } from "@/updates/UpdateGate";
import { onLookRequest } from "@/look";
import { canvasOf, colors, isDark, onThemeChange, setThemeChoice, themeChoice, themeVersion } from "@/theme";

// Keep the splash screen up until we know whether someone is signed in,
// so the login screen never flashes for a signed-in person.
void SplashScreen.preventAutoHideAsync();

// A look picked in Account also applies to the phone's own pieces: keyboard, alerts, pickers.
if (themeChoice !== "system") Appearance.setColorScheme(themeChoice);


/** Screens opened on top of the tabs share one plain header: back arrow, centred title, no shadow. */
const pushed = () => ({
  headerShown: true,
  headerBackButtonDisplayMode: "minimal" as const,
  headerTitleAlign: "center" as const,
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.foreground,
  headerTitleStyle: { fontWeight: "600" as const, fontSize: 17 },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.canvas }
});

function Screens({ look }: { look: number }) {
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

  // After the look changes the screens are drawn again from the start; go back to Account, where it was changed.
  const drawn = useRef(look);
  useEffect(() => {
    if (drawn.current === look) return;
    drawn.current = look;
    if (signedIn) router.navigate("/(tabs)/account");
  }, [look, signedIn, router]);

  if (!ready) return null;
  const header = pushed();
  const stack = (
    <Stack key={look} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        {/* The live map: full screen, over the tabs. Opened from Home, a vehicle, or a status tile. */}
        <Stack.Screen name="map" options={{ animation: "fade" }} />
        <Stack.Screen name="vehicle/[id]" options={{ ...header, title: "Vehicle" }} />
        <Stack.Screen name="trips/[id]" options={{ ...header, title: "Trips" }} />
        <Stack.Screen name="trip" options={{ ...header, title: "Trip" }} />
        <Stack.Screen name="password" options={{ ...header, title: "Change password" }} />
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
  const [look, setLook] = useState(themeVersion());
  const [cover, setCover] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  // The phone switched between light and dark while the app follows it.
  useEffect(() => onThemeChange(() => setLook(themeVersion())), []);

  // A look picked in Account: fade to the new background, redraw underneath, fade back in.
  useEffect(
    () =>
      onLookRequest((choice) => {
        setCover(canvasOf(choice));
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start(() => {
          setThemeChoice(choice);
          setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setCover(null)), 180);
        });
      }),
    [fade]
  );

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? "light" : "dark"} />
      {/* Before anything else: an app version the server no longer supports can't be used. */}
      <UpdateGate>
        <SessionProvider>
          <Screens look={look} />
        </SessionProvider>
      </UpdateGate>
      {cover ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: cover, opacity: fade }]} /> : null}
    </SafeAreaProvider>
  );
}
