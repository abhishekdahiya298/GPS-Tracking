import Constants, { ExecutionEnvironment } from "expo-constants";
import { Suspense, lazy } from "react";
import { StyleSheet, View } from "react-native";
import { Loading } from "@/components/kit";
import { Placeholder } from "@/components/Placeholder";
import { colors, themed } from "@/theme";

// The map engine is native code that Expo Go does not contain. Loading it there would crash the
// whole app, so it is only loaded in the installed app.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const LiveMap = inExpoGo ? null : lazy(() => import("@/map/LiveMap"));

/** The Map tab. The map runs edge to edge, under the status bar; its controls float on top. */
export default function MapScreen() {
  if (!LiveMap) return <Placeholder icon="map-outline" title="Live map" note="The map needs the installed RIO GPS app. It can't run inside Expo Go." />;
  return (
    <View style={styles.wrap}>
      <Suspense fallback={<Loading text="Opening the map" />}>
        <LiveMap />
      </Suspense>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({ wrap: { flex: 1, backgroundColor: colors.canvas } }));
