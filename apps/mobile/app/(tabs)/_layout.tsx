import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { useAlerts } from "@/alerts/AlertsProvider";
import { badgeText } from "@/alerts/model";
import { colors } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => function TabIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
};

export default function TabsLayout() {
  const { unread } = useAlerts();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primaryDark },
        headerTintColor: colors.primaryForeground,
        headerTitleStyle: { fontWeight: "600" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.offline,
        tabBarStyle: { borderTopColor: colors.border }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Map", tabBarIcon: icon("map-outline") }} />
      <Tabs.Screen name="vehicles" options={{ title: "Vehicles", tabBarIcon: icon("bus-outline") }} />
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarIcon: icon("notifications-outline"), tabBarBadge: badgeText(unread), tabBarBadgeStyle: { backgroundColor: colors.danger } }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
