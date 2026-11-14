/**
 * Shared screen pieces, so every screen looks and moves the same way: screen header, status
 * pill, icon well, vehicle avatar, filter chip, segmented control, search box, card, grouped
 * rows, empty state, loading rows.
 */
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Animated, Image, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STATE_META, type FleetState } from "../fleet/model";
import { haptic } from "../haptics";
import { colors, elevation, font, ink, isDark, radius, size, softTint, space, type } from "../theme";
import { Dots, FadeInUp, PopIn, PressableScale, Skeleton } from "./motion";

export type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The top of a tab: a large title, an optional count badge beside it, and one action on the
 * right. It leaves room for the phone's status bar itself.
 */
export function ScreenHeader({ title, badge, badgeTone = "brand", right, children }: { title: string; badge?: string; badgeTone?: "brand" | "danger"; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const tint = badgeTone === "danger" ? colors.danger : colors.primary;
  const soft = badgeTone === "danger" ? colors.dangerSoft : colors.primarySoft;
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.headerRow}>
        <Text style={type.largeTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {badge ? (
          <PopIn key={badge} style={[styles.headerBadge, { backgroundColor: soft }]}>
            <Text style={[styles.headerBadgeText, { color: tint }]}>{badge}</Text>
          </PopIn>
        ) : null}
        <View style={styles.flex} />
        {right}
      </View>
      {children}
    </View>
  );
}

/** The small shape that says the state without colour: play, pause, square, no signal. */
const STATE_GLYPH: Record<FleetState, IconName> = { moving: "play", idle: "pause", stopped: "square", parked: "unlink", offline: "cloud-offline", never_seen: "cloud-offline" };

/** "Moving", "Idling" … in the status colour, with its shape. The shape pulses while the vehicle moves. */
export const StatusPill = memo(function StatusPill({ state, compact = false }: { state: FleetState; compact?: boolean }) {
  const meta = STATE_META[state];
  return (
    <View style={[styles.pill, { backgroundColor: softTint(meta.color, meta.soft) }]}>
      <Ionicons name={STATE_GLYPH[state]} size={state === "stopped" ? 8 : 10} color={ink(meta.color)} />
      <Text style={[styles.pillText, { color: ink(meta.color) }]} numberOfLines={1}>
        {compact && state === "parked" ? "Parked" : meta.label}
      </Text>
    </View>
  );
});

/** The tinted rounded square behind an icon. One size and shape everywhere. */
export function IconWell({ icon, color = colors.primary, soft = colors.primarySoft, box = size.well }: { icon: IconName; color?: string; soft?: string; box?: number }) {
  return (
    <View style={[styles.well, { width: box, height: box, backgroundColor: softTint(color, soft) }]}>
      <Ionicons name={icon} size={Math.round(box * 0.5)} color={ink(color)} />
    </View>
  );
}

const TYPE_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = { truck: "truck-outline", semi: "truck-outline", bus: "bus", equipment: "excavator", trailer: "truck-trailer", van: "van-utility", car: "car-outline", pickup: "car-pickup" };

/** The rounded square at the start of a vehicle row: an icon for the kind of vehicle, tinted by status. */
export const VehicleAvatar = memo(function VehicleAvatar({ type: kind, state, size: box = size.well }: { type: string | undefined; state: FleetState; size?: number }) {
  const meta = STATE_META[state];
  return (
    <View style={[styles.well, { width: box, height: box, borderRadius: box > 44 ? radius.xl : radius.lg, backgroundColor: softTint(meta.color, meta.soft) }]}>
      <MaterialCommunityIcons name={TYPE_ICON[kind ?? ""] ?? "car-outline"} size={Math.round(box * 0.55)} color={ink(meta.color)} />
    </View>
  );
});

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const PICTURES = { truck: require("../../assets/vehicles/vehicle-truck.png") as number, trailer: require("../../assets/vehicles/vehicle-trailer.png") as number };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The vehicle picture on cards and sheets: one white tractor-trailer for every powered vehicle
 * and one trailer for trailers, on a soft blue tile. The same two pictures everywhere.
 */
export const VehiclePicture = memo(function VehiclePicture({ type: kind, width = 72, height = 56 }: { type: string | undefined; width?: number; height?: number }) {
  return (
    <View style={[styles.picture, { width, height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={kind === "trailer" ? PICTURES.trailer : PICTURES.truck} style={{ width: width - 6, height: height - 6 }} resizeMode="contain" />
    </View>
  );
});

/**
 * One live fact in a row of four, on its own soft colour: the icon, a small label and the value in
 * bold. `valueColor` lets the value say good/bad while the tile keeps its own colour.
 */
export function FactTile({ icon, label, value, color = colors.primary, soft = colors.primarySoft, valueColor }: { icon: IconName; label: string; value: string; color?: string; soft?: string; valueColor?: string }) {
  return (
    <View style={[styles.fact, { backgroundColor: softTint(color, soft), borderColor: isDark ? colors.border : `${color}3d` }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={22} color={ink(color)} />
      <Text style={styles.factLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.factValue, { color: ink(valueColor ?? color) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{value}</Text>
    </View>
  );
}

/** The speed band on a vehicle sheet: deep blue with white figures, speed on the left, what it is doing on the right. */
export function SpeedBar({ speed, unit, title, detail, headingDeg }: { speed: string; unit: string; title: string; detail: string; headingDeg?: number | null }) {
  return (
    <LinearGradient colors={["#1d4ed8", "#0f2e8a"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.speedBar}>
      <View style={styles.speedSide}>
        <Ionicons name="speedometer-outline" size={28} color="#ffffff" />
        <Text style={styles.speedValue} numberOfLines={1}>
          {speed}
          <Text style={styles.speedUnit}>{` ${unit}`}</Text>
        </Text>
      </View>
      <View style={styles.speedRule} />
      <View style={[styles.speedSide, styles.speedRight]}>
        <Ionicons name="navigate-outline" size={22} color="#ffffff" style={{ transform: [{ rotate: `${(headingDeg ?? 45) - 45}deg` }] }} />
        <View style={styles.flex}>
          <Text style={styles.speedTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.speedDetail} numberOfLines={1}>{detail}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

/**
 * The address block: a pin, the street on one line, the place and coordinates below, and a copy
 * button. When the address is not known yet it shows the coordinates only, never a guess.
 */
export function AddressCard({ title, line, coords, label, onCopy }: { title: string | null; line?: string | null; coords: string; label?: string; onCopy?: () => void }) {
  return (
    <View style={styles.address}>
      <Ionicons name="location" size={20} color={colors.primary} />
      <View style={styles.flex}>
        {label ? <Text style={type.caption}>{label}</Text> : null}
        <Text style={styles.addressTitle} numberOfLines={1}>{title ?? coords}</Text>
        {line ? <Text style={type.caption} numberOfLines={1}>{line}</Text> : null}
        {title ? <Text style={type.caption}>{coords}</Text> : null}
      </View>
      {onCopy ? (
        <PressableScale onPress={onCopy} hitSlop={8} style={styles.addressCopy} accessibilityRole="button" accessibilityLabel="Copy address">
          <Ionicons name="copy-outline" size={18} color={colors.primary} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Shape for each filter chip: the same shapes as the status pills; "All" shows stacked layers. */
const FILTER_GLYPH: Record<string, IconName> = { all: "layers", moving: "play", idle: "pause", stopped: "square", offline: "cloud-offline" };

/** A filter chip: a small tinted tile with the status shape, the label and how many there are. */
export const Chip = memo(function Chip({ label, count, selected, dot, glyph, onPress }: { label: string; count?: number; selected: boolean; dot?: string; glyph?: string; onPress: () => void }) {
  const tint = dot ?? colors.primary;
  const icon = glyph ? FILTER_GLYPH[glyph] : undefined;
  return (
    <PressableScale onPress={onPress} hitSlop={4} style={[styles.chip, selected && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={count === undefined ? label : `${label}, ${count}`}>
      {icon ? (
        <View style={[styles.chipTile, { backgroundColor: selected ? "rgba(255,255,255,0.18)" : softTint(tint, colors.primarySoft) }]}>
          <Ionicons name={icon} size={11} color={selected ? colors.primaryForeground : ink(tint)} />
        </View>
      ) : dot && !selected ? (
        <View style={[styles.chipDot, { backgroundColor: ink(dot) }]} />
      ) : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>
        {label}
        {count !== undefined ? <Text style={styles.chipCount}>{` ${count}`}</Text> : ""}
      </Text>
    </PressableScale>
  );
});

/**
 * A row of two to four choices where one is always picked. The white thumb slides to the
 * choice. Used for All / Unread, the look of the app, and playback speed.
 */
export function Segmented<T extends string | number | boolean>({ options, value, onChange, label }: { options: ReadonlyArray<{ value: T; label: string; icon?: IconName }>; value: T; onChange: (value: T) => void; label: string }) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const slide = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: index, useNativeDriver: true, speed: 22, bounciness: 5 }).start();
  }, [index, slide]);
  const thumb = width > 0 ? (width - 8) / options.length : 0;
  return (
    <View style={styles.segment} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {thumb > 0 ? <Animated.View pointerEvents="none" style={[styles.segmentThumb, { width: thumb, transform: [{ translateX: Animated.multiply(slide, thumb) }] }]} /> : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              if (on) return;
              haptic.tap();
              onChange(o.value);
            }}
            style={styles.segmentItem}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? colors.primary : colors.mutedForeground} /> : null}
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBox({ value, onChangeText, placeholder, label }: { value: string; onChangeText: (text: string) => void; placeholder: string; label: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={size.icon} color={colors.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel={label}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={colors.offline} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Small capitals above a group: "NOTIFICATIONS". */
export function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel} accessibilityRole="header">{text}</Text>;
}

/**
 * The outline of one row in a long list drawn as a single rounded card. Each row carries its
 * own piece of the card's edge, so the list can still recycle rows as it scrolls.
 */
export function groupedRow(first: boolean, last: boolean): StyleProp<ViewStyle> {
  return [styles.grouped, first && styles.groupedFirst, last && styles.groupedLast];
}

/** The hairline between two rows, starting after the icon. */
export function RowLine({ inset = space.md + size.well + space.md }: { inset?: number }) {
  return (
    <View style={styles.rowLineWrap}>
      <View style={[styles.rowLine, { marginLeft: inset }]} />
    </View>
  );
}

/** Centred icon, title and one line of help, for "nothing here" and "could not load". */
export function EmptyState({ icon, title, note, tone = "neutral", children }: { icon: IconName; title: string; note?: string; tone?: "neutral" | "brand" | "danger"; children?: ReactNode }) {
  const tint = tone === "brand" ? colors.primary : tone === "danger" ? colors.danger : colors.offline;
  const soft = tone === "brand" ? colors.primarySoft : tone === "danger" ? colors.dangerSoft : colors.muted;
  return (
    <FadeInUp style={styles.empty}>
      <View style={[styles.emptyBadge, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={28} color={tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {note ? <Text style={styles.emptyNote}>{note}</Text> : null}
      {children ? <View style={styles.emptyAction}>{children}</View> : null}
    </FadeInUp>
  );
}

/** A calm "working" state for a whole area: moving dots and one line of what is happening. */
export function Loading({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Dots />
      <Text style={styles.loadingText}>{text}</Text>
    </View>
  );
}

/** Placeholder rows shown while a list loads for the first time. They have the size of real rows. */
export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={styles.skeletonCard}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.rowLine, { marginLeft: space.md + size.well + space.md }]} /> : null}
          <View style={styles.skeletonRow}>
            <Skeleton width={size.well} height={size.well} round={radius.lg} />
            <View style={styles.skeletonText}>
              <Skeleton width={`${55 - (i % 3) * 8}%`} height={14} />
              <Skeleton width={`${38 + (i % 2) * 10}%`} height={11} />
            </View>
            <Skeleton width={64} height={22} round={11} />
          </View>
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
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.md, backgroundColor: colors.canvas },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: size.controlSm },
  headerBadge: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999 },
  headerBadgeText: { fontSize: font.small, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 8, paddingRight: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: font.caption, lineHeight: 16, fontWeight: "700" },
  picture: { borderRadius: radius.lg, borderWidth: 1, borderColor: isDark ? colors.border : "#d3ddeb", backgroundColor: isDark ? "#1c2636" : "#e2eaf7", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fact: { flex: 1, minWidth: 0, alignItems: "center", gap: 2, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 4, borderRadius: radius.xl, borderWidth: 1 },
  factValue: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  factLabel: { ...type.caption, color: colors.foreground, marginTop: 2 },
  speedBar: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.xl + 2, ...elevation.md },
  speedSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  speedRight: { flex: 1.3, minWidth: 0 },
  speedRule: { width: 1, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.3)", marginHorizontal: 14 },
  speedValue: { fontSize: 30, lineHeight: 34, fontWeight: "800", color: "#ffffff", fontVariant: ["tabular-nums"] },
  speedUnit: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.85)" },
  speedTitle: { fontSize: 13, lineHeight: 18, fontStyle: "italic", color: "rgba(255,255,255,0.85)" },
  speedDetail: { fontSize: 15, lineHeight: 20, fontWeight: "800", color: "#ffffff", fontVariant: ["tabular-nums"] },
  address: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingLeft: space.md, paddingRight: 6, borderRadius: radius.xl, backgroundColor: colors.primarySoft },
  addressTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  addressCopy: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  well: { borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 6, paddingRight: 11, height: 38, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, ...elevation.sm },
  chipOn: { backgroundColor: isDark ? colors.primary : "#0f1f4d", borderColor: isDark ? colors.primary : "#0f1f4d" },
  chipTile: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  chipCount: { fontWeight: "600", opacity: 0.7 },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: font.small, lineHeight: 18, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] },
  chipTextOn: { color: colors.primaryForeground },
  segment: { flexDirection: "row", height: size.controlSm, padding: 4, borderRadius: radius.lg, backgroundColor: colors.muted },
  segmentThumb: { position: "absolute", left: 4, top: 4, bottom: 4, borderRadius: radius.md - 1, backgroundColor: colors.background, ...elevation.sm },
  segmentItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space.xs },
  segmentText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.mutedForeground, fontVariant: ["tabular-nums"] },
  segmentTextOn: { color: colors.foreground },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 14, height: size.controlSm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  // 16px text: iOS zooms the screen on focus for anything smaller.
  searchInput: { flex: 1, fontSize: 16, color: colors.foreground, paddingVertical: 0 },
  card: { backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  sectionLabel: { ...type.label, paddingHorizontal: space.xs, marginBottom: space.sm },
  grouped: { marginHorizontal: space.lg, backgroundColor: colors.background, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border, overflow: "hidden" },
  groupedFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  groupedLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  rowLineWrap: { marginHorizontal: space.lg, backgroundColor: colors.background, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  rowLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  emptyBadge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  emptyTitle: { ...type.title, textAlign: "center" },
  emptyNote: { ...type.body, color: colors.mutedForeground, textAlign: "center" },
  emptyAction: { marginTop: space.md, alignSelf: "stretch" },
  loadingText: { ...type.small, marginTop: space.sm, textAlign: "center" },
  skeletonCard: { marginHorizontal: space.lg, backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: size.row + 4 },
  skeletonText: { flex: 1, gap: space.sm },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.warningSoft, paddingHorizontal: space.lg, paddingVertical: space.sm },
  bannerText: { flex: 1, color: colors.warning, fontSize: font.small, lineHeight: 18 }
});
