/**
 * Shared screen pieces, so every screen looks and moves the same way:
 * status pill, vehicle avatar, filter chip, search box, card, empty state, loading rows.
 */
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { STATE_META, type FleetState } from "../fleet/model";
import { colors, elevation, font, gradient, ink, radius, softTint, space } from "../theme";
import { FadeInUp, PressableScale, PulseDot, Skeleton } from "./motion";

type IconName = keyof typeof Ionicons.glyphMap;

/** The brand gradient, used behind every header. */
export function HeaderBackground() {
  return <LinearGradient colors={gradient.brand} start={gradient.angle.start} end={gradient.angle.end} style={StyleSheet.absoluteFill} />;
}

/** "Moving", "Idling" … with the status colour. The dot pulses while the vehicle is moving. */
export function StatusPill({ state, compact = false }: { state: FleetState; compact?: boolean }) {
  const meta = STATE_META[state];
  return (
    <View style={[styles.pill, { backgroundColor: softTint(meta.color, meta.soft) }]}>
      <PulseDot color={ink(meta.color)} live={state === "moving"} />
      <Text style={[styles.pillText, { color: ink(meta.color) }]} numberOfLines={1}>
        {compact && state === "parked" ? "Parked" : meta.label}
      </Text>
    </View>
  );
}

const TYPE_ICON: Record<string, IconName> = { truck: "bus", semi: "bus", bus: "bus", equipment: "construct", trailer: "cube", van: "bus", car: "car-sport", pickup: "car-sport" };

/** The rounded square at the start of a vehicle row: an icon for the kind of vehicle, tinted by status. */
export function VehicleAvatar({ type, state, size = 46 }: { type: string | undefined; state: FleetState; size?: number }) {
  const meta = STATE_META[state];
  return (
    <View style={[styles.avatar, { width: size, height: size, backgroundColor: softTint(meta.color, meta.soft) }]}>
      <Ionicons name={TYPE_ICON[type ?? ""] ?? "navigate"} size={size * 0.5} color={ink(meta.color)} />
    </View>
  );
}

/** A filter chip with an optional count and status dot. */
export function Chip({ label, count, selected, dot, onPress }: { label: string; count?: number; selected: boolean; dot?: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={[styles.chip, selected && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={count === undefined ? label : `${label}, ${count}`}>
      {dot && !selected ? <View style={[styles.chipDot, { backgroundColor: ink(dot) }]} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
      {count !== undefined ? (
        <View style={[styles.chipCount, selected && styles.chipCountOn]}>
          <Text style={[styles.chipCountText, selected && styles.chipTextOn]}>{count}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

export function SearchBox({ value, onChangeText, placeholder, label }: { value: string; onChangeText: (text: string) => void; placeholder: string; label: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.offline} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.offline}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel={label}
        style={styles.searchInput}
      />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Centred icon, title and one line of help, for "nothing here" and "could not load". */
export function EmptyState({ icon, title, note, tone = "neutral", children }: { icon: IconName; title: string; note?: string; tone?: "neutral" | "brand" | "danger"; children?: ReactNode }) {
  const tint = tone === "brand" ? colors.primary : tone === "danger" ? colors.danger : colors.offline;
  const soft = tone === "brand" ? colors.primarySoft : tone === "danger" ? colors.dangerSoft : colors.muted;
  return (
    <FadeInUp style={styles.empty}>
      <View style={[styles.emptyBadge, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={30} color={tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {note ? <Text style={styles.emptyNote}>{note}</Text> : null}
      {children ? <View style={styles.emptyAction}>{children}</View> : null}
    </FadeInUp>
  );
}

/** Placeholder rows shown while a list loads for the first time. */
export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton width={46} height={46} round={radius.xl} />
          <View style={styles.skeletonText}>
            <Skeleton width={`${55 - (i % 3) * 8}%`} height={15} />
            <Skeleton width={`${38 + (i % 2) * 10}%`} height={12} />
          </View>
          <Skeleton width={64} height={24} round={12} />
        </View>
      ))}
    </View>
  );
}

/** A thin warning strip under the header: "Showing the last update …". */
export function Banner({ text }: { text: string }) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  pillText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.1 },
  avatar: { borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.md, paddingRight: space.sm, minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary, ...elevation.sm },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: font.small, fontWeight: "600", color: colors.foreground },
  chipTextOn: { color: colors.primaryForeground },
  chipCount: { minWidth: 22, paddingHorizontal: 6, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  chipCountOn: { backgroundColor: "rgba(255,255,255,0.2)" },
  chipCountText: { fontSize: 12, fontWeight: "700", color: colors.mutedForeground },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 46, borderRadius: radius.xl, backgroundColor: colors.muted },
  // 16px text: iOS zooms the screen on focus for anything smaller.
  searchInput: { flex: 1, fontSize: 16, color: colors.foreground, paddingVertical: space.sm },
  card: { backgroundColor: colors.background, borderRadius: 16, padding: space.lg, ...elevation.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  emptyBadge: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  emptyTitle: { fontSize: font.title, fontWeight: "700", color: colors.foreground, textAlign: "center" },
  emptyNote: { fontSize: font.body, color: colors.mutedForeground, textAlign: "center", lineHeight: 21 },
  emptyAction: { marginTop: space.md, alignSelf: "stretch" },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 72 },
  skeletonText: { flex: 1, gap: space.sm },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.warningSoft, paddingHorizontal: space.lg, paddingVertical: space.sm },
  bannerText: { flex: 1, color: colors.warning, fontSize: font.small }
});
