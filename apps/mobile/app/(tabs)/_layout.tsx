import { Tabs } from "expo-router";
import { useAlerts } from "@/alerts/AlertsProvider";
import { badgeText } from "@/alerts/model";
import { HeaderBackground } from "@/components/kit";
import { TabBar } from "@/components/TabBar";
import { colors } from "@/theme";

export default function TabsLayout() {
  const { unread } = useAlerts();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: colors.primaryForeground,
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        headerShadowVisible: false
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Map" }} />
      <Tabs.Screen name="vehicles" options={{ title: "Vehicles" }} />
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarBadge: badgeText(unread) }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
