/**
 * The bottom tab bar: a pill slides under the active tab, the active icon fills in and
 * pops slightly, and the alert count sits on the bell.
 */
import { Ionicons } from "@expo/vector-icons";
import type { Tabs } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { colors, elevation } from "../theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
type IconName = keyof typeof Ionicons.glyphMap;

/** Outline icon when idle, filled when active. Keyed by route name. */
export const TAB_ICONS: Record<string, { idle: IconName; active: IconName }> = {
  index: { idle: "map-outline", active: "map" },
  vehicles: { idle: "bus-outline", active: "bus" },
  alerts: { idle: "notifications-outline", active: "notifications" },
  account: { idle: "person-circle-outline", active: "person-circle" }
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: 12 }).start();
  }, [focused, pop]);
  const icons = TAB_ICONS[name] ?? { idle: "ellipse-outline" as IconName, active: "ellipse" as IconName };
  return (
    <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }, { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] }}>
      <Ionicons name={focused ? icons.active : icons.idle} size={24} color={focused ? colors.primary : colors.offline} />
    </Animated.View>
  );
}

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabWidth = count > 0 ? width / count : 0;
  const slide = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    Animated.spring(slide, { toValue: state.index, useNativeDriver: true, speed: 18, bounciness: 7 }).start();
  }, [state.index, slide]);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {tabWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.indicatorSlot, { width: tabWidth, transform: [{ translateX: Animated.multiply(slide, tabWidth) }] }]}>
          <View style={styles.indicator} />
        </Animated.View>
      ) : null}
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
            <View>
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

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.background, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, ...elevation.md },
  indicatorSlot: { position: "absolute", top: 6, left: 0, height: 34, alignItems: "center", justifyContent: "center" },
  indicator: { width: 58, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft },
  tab: { flex: 1, alignItems: "center", gap: 3, minHeight: 52 },
  label: { fontSize: 11, fontWeight: "500", color: colors.offline },
  labelOn: { color: colors.primary, fontWeight: "700" },
  badge: { position: "absolute", top: -4, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.background },
  badgeText: { color: "#ffffff", fontSize: 10, fontWeight: "700" }
});
