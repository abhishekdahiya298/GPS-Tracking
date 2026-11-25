/** Pieces the driver screens share: header, cards, load card, stop row. */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, elevation, radius, space, themed } from "@/theme";
import { navigateTo } from "./DriverData";
import { loadStage, placeName, type DriverLoad } from "./model";

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");

export function DriverHeader({ company }: { company: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
      <View style={styles.rule} />
      <Text style={styles.company} numberOfLines={1}>
        {company}
      </Text>
    </View>
  );
}

export function Tile({ icon, color, soft, size = 38 }: { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string; size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: soft }]}>
      <Ionicons name={icon} size={Math.round(size / 2)} color={color} />
    </View>
  );
}

export function Row({ icon, color, soft, title, detail, onPress, right }: { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string; title: string; detail?: string | null; onPress?: () => void; right?: ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} style={({ pressed }) => [styles.row, pressed && onPress && { opacity: 0.8 }]}>
      <Tile icon={icon} color={color} soft={soft} size={36} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} /> : null)}
    </Pressable>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function Pill({ text, color, soft }: { text: string; color: string; soft: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: soft }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

const TONE = { brand: ["#1d4ed8", "#dbe4f8"], warning: ["#a3470a", "#fcd9b2"], success: ["#136c35", "#c8e8d2"], neutral: ["#4b5563", "#d6dbe3"] } as const;
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null);
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : null);

/** A load as a card with a status edge (D9): reference, stage, route, next stop, Navigate. */
export function LoadCard({ load, expanded, onPress, dispatchPhone }: { load: DriverLoad; expanded?: boolean; onPress?: () => void; dispatchPhone?: string | null }) {
  const st = loadStage(load.status);
  const [fg, bg] = TONE[st.tone];
  const next = st.next === "pickup" ? load.pickup : st.next === "delivery" ? load.delivery : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.load, { borderColor: bg }]}>
      <View style={[styles.edge, { backgroundColor: fg }]} />
      <View style={styles.loadTop}>
        <Tile icon="cube-outline" color={fg} soft={bg} />
        <View style={styles.flex}>
          <View style={styles.loadTitleRow}>
            <Text style={styles.loadRef}>{load.reference}</Text>
            <Pill text={st.label} color={fg} soft={bg} />
          </View>
          <Text style={styles.route} numberOfLines={1}>
            {placeName(load.pickup)} → {placeName(load.delivery)}
          </Text>
        </View>
      </View>
      {next ? (
        <View style={styles.next}>
          <Ionicons name="location" size={16} color={st.next === "pickup" ? "#136c35" : "#d81e2c"} />
          <View style={styles.flex}>
            <Text style={styles.nextLabel}>{st.next === "pickup" ? "PICKUP" : "DELIVERY"}</Text>
            <Text style={styles.nextName}>{placeName(next)}</Text>
            <Text style={styles.nextAddr} numberOfLines={2}>
              {next.address}
            </Text>
            {next.appointmentAt ? (
              <Text style={styles.nextAppt}>
                Appointment {dayOf(next.appointmentAt)} · {timeOf(next.appointmentAt)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {expanded ? (
        <View style={styles.stops}>
          <Stop kind="pickup" s={load.pickup} />
          <Stop kind="delivery" s={load.delivery} />
          {load.notes ? <Text style={styles.notes}>{load.notes}</Text> : null}
        </View>
      ) : null}
      {next || expanded ? (
        <View style={styles.actions}>
          {next ? (
            <Pressable onPress={() => navigateTo(next.lat, next.lon, placeName(next))} style={[styles.action, styles.actionMain]} accessibilityRole="button">
              <Ionicons name="navigate" size={16} color="#ffffff" />
              <Text style={styles.actionMainText}>Navigate</Text>
            </Pressable>
          ) : null}
          {dispatchPhone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${dispatchPhone}`)} style={styles.action} accessibilityRole="button">
              <Ionicons name="call-outline" size={16} color={colors.foreground} />
              <Text style={styles.actionText}>Call</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Stop({ kind, s }: { kind: "pickup" | "delivery"; s: DriverLoad["pickup"] }) {
  const color = kind === "pickup" ? "#136c35" : "#d81e2c";
  return (
    <Pressable onPress={() => navigateTo(s.lat, s.lon, placeName(s))} style={styles.stop} accessibilityRole="button" accessibilityLabel={`Navigate to ${kind} ${placeName(s)}`}>
      <View style={[styles.stopDot, { backgroundColor: color }]}>
        <Text style={styles.stopDotText}>{kind === "pickup" ? "P" : "D"}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.nextName}>{placeName(s)}</Text>
        <Text style={styles.nextAddr}>{s.address}</Text>
        {s.appointmentAt ? <Text style={styles.nextAppt}>{`${dayOf(s.appointmentAt)} · ${timeOf(s.appointmentAt)}`}</Text> : null}
      </View>
      <Ionicons name="navigate-outline" size={18} color={colors.primary} />
    </Pressable>
  );
}

export const driverStyles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.4, color: colors.foreground },
  sub: { fontSize: 13, color: colors.mutedForeground },
  section: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, color: colors.mutedForeground, marginTop: space.sm }
}));

const styles = themed(() => ({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.canvas },
  logo: { width: 70, height: 34 },
  rule: { width: 1, height: 24, backgroundColor: colors.border },
  company: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.foreground },
  tile: { borderRadius: 12, alignItems: "center", justifyContent: "center" },
  group: { borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60, borderBottomWidth: 1, borderBottomColor: colors.muted },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  rowDetail: { fontSize: 13, color: colors.mutedForeground },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 99 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "700" },
  load: { position: "relative", gap: space.md, padding: 14, paddingLeft: 18, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, overflow: "hidden", ...elevation.sm },
  edge: { position: "absolute", left: 0, top: 10, bottom: 10, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  loadTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  loadTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  loadRef: { fontSize: 17, fontWeight: "700", color: colors.foreground },
  route: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
  next: { flexDirection: "row", gap: space.sm, padding: 12, borderRadius: radius.lg, backgroundColor: colors.muted },
  nextLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, color: colors.mutedForeground },
  nextName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  nextAddr: { fontSize: 13, color: colors.mutedForeground },
  nextAppt: { fontSize: 12.5, fontWeight: "600", color: colors.foreground, marginTop: 2 },
  stops: { gap: space.sm },
  stop: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  stopDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stopDotText: { color: "#ffffff", fontWeight: "800", fontSize: 12 },
  notes: { fontSize: 13, color: colors.foreground, padding: 10, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  actions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  actionMain: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  actionMainText: { fontSize: 14, fontWeight: "700", color: "#ffffff" }
}));
