import { Tabs } from "expo-router";
import { useAlerts } from "@/alerts/AlertsProvider";
import { badgeText } from "@/alerts/model";
import { TabBar } from "@/components/TabBar";
import { colors } from "@/theme";

/** The four tabs. The live map opens full screen from Home. Each screen draws its own title, so the system header is off. */
export default function TabsLayout() {
  const { unread } = useAlerts();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="vehicles" options={{ title: "Vehicles" }} />
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarBadge: badgeText(unread) }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
