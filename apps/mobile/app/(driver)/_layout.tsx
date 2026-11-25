import { Tabs } from "expo-router";
import { TabBar } from "@/components/TabBar";
import { colors } from "@/theme";

export const unstable_settings = { initialRouteName: "today" };

/** The driver's tabs: Today, Loads, Map, Account. Location is shared all the time while signed in. */
export default function DriverTabs() {
  return (
      <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}>
        <Tabs.Screen name="today" options={{ title: "Today" }} />
        <Tabs.Screen name="loads" options={{ title: "Loads" }} />
        <Tabs.Screen name="drive" options={{ title: "Map" }} />
        <Tabs.Screen name="me" options={{ title: "Account" }} />
      </Tabs>
  );
}
