/**
 * The bottom tab bar: five tabs of equal width. The active tab turns blue, its icon fills in
 * and pops slightly, and the alert count sits on the bell.
 */
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { Tabs } from "expo-router";
import { useEffect, useRef, type ComponentProps } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { colors, ink, size, themed } from "../theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
type IconName = keyof typeof Ionicons.glyphMap;

/** Outline icon when idle, filled when active. Keyed by route name. */
const TAB_ICONS: Record<string, { idle: IconName; active: IconName }> = {
  index: { idle: "home-outline", active: "home" },
  map: { idle: "map-outline", active: "map" },
  alerts: { idle: "notifications-outline", active: "notifications" },
  account: { idle: "person-outline", active: "person" }
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: 12 }).start();
  }, [focused, pop]);
  const tint = focused ? ink(colors.primary) : colors.mutedForeground;
  const icons = TAB_ICONS[name];
  return (
    <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] }}>
      {name === "vehicles" ? (
        <MaterialCommunityIcons name={focused ? "truck" : "truck-outline"} size={size.tabIcon + 1} color={tint} />
      ) : (
        <Ionicons name={focused ? (icons?.active ?? "ellipse") : (icons?.idle ?? "ellipse-outline")} size={size.tabIcon} color={tint} />
      )}
    </Animated.View>
  );
}

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        const focused = state.index === index;
        const label = typeof options.title === "string" ? options.title : route.name;
        const badge = options.tabBarBadge;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptic.tap();
            navigation.navigate(route.name, route.params);
          }
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
          >
            <View style={[styles.iconPill, focused && styles.iconPillOn]}>
              <TabIcon name={route.name} focused={focused} />
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.background, paddingTop: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 48 },
  iconPill: { minWidth: 52, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconPillOn: { backgroundColor: colors.primarySoft },
  label: { fontSize: 11, lineHeight: 14, fontWeight: "500", color: colors.mutedForeground },
  labelOn: { color: ink(colors.primary), fontWeight: "600" },
  badge: { position: "absolute", top: -3, right: 4, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.background },
  badgeText: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "700" }
}));
