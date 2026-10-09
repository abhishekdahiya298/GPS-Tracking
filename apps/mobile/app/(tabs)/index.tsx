import Constants, { ExecutionEnvironment } from "expo-constants";
import { Suspense, lazy } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Placeholder } from "@/components/Placeholder";
import { colors } from "@/theme";

// The map engine is native code that Expo Go does not contain. Loading it there would crash the
// whole app, so it is only loaded in the installed app.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const LiveMap = inExpoGo ? null : lazy(() => import("@/map/LiveMap"));

export default function MapScreen() {
  if (!LiveMap) return <Placeholder icon="map-outline" title="Live map" note="The map needs the installed RIO GPS app. It can't run inside Expo Go." />;
  return (
    <Suspense
      fallback={
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      }
    >
      <LiveMap />
    </Suspense>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas } });
