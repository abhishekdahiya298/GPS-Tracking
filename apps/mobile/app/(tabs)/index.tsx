import Constants, { ExecutionEnvironment } from "expo-constants";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Suspense, lazy } from "react";
import { View } from "react-native";
import { Loading } from "@/components/kit";
import { Placeholder } from "@/components/Placeholder";
import { colors, themed } from "@/theme";

// The map engine is native code that Expo Go does not contain. Loading it there would crash the
// whole app, so it is only loaded in the installed app.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const LiveMap = inExpoGo ? null : lazy(() => import("@/map/LiveMap"));

/** The Map tab. The map runs edge to edge, under the status bar; its controls float on top. */
// The app opens on Overview (the day at a glance); the map is one tap away. Asked for once per
// launch, and never when a vehicle was asked for by name.
let opened = false;

export default function MapScreen() {
  const { device } = useLocalSearchParams<{ device?: string }>();
  if (!opened) {
    opened = true;
    if (!device) return <Redirect href="/(tabs)/overview" />;
  }
  if (!LiveMap) return <Placeholder icon="map-outline" title="Live map" note="The map needs the installed RIO GPS app. It can't run inside Expo Go." />;
  return (
    <View style={styles.wrap}>
      <Suspense fallback={<Loading text="Opening the map" />}>
        <LiveMap />
      </Suspense>
    </View>
  );
}

const styles = themed(() => ({ wrap: { flex: 1, backgroundColor: colors.canvas } }));
