import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill, VehiclePicture } from "../components/kit";
import { PressableScale } from "../components/motion";
import { colors, elevation, ink, isDark, radius, softTint, space, type } from "../theme";
import { STATE_META, coordsText, displayName, fleetState, freshnessLine, vehicleFacts, type FleetDevice, type VehicleFact } from "./model";

/** Gap under each card. */
const GAP = 10;
/** The height a card takes in a list, gap included. Lists place cards without measuring them. */
export const ROW_HEIGHT = 124 + GAP;
/** Kept for lists that still draw hairlines; cards don't need them. */
export const ROW_INSET = 0;

const FACT_ICON: Record<VehicleFact["key"], keyof typeof Ionicons.glyphMap> = { ignition: "power", heading: "navigate", trailer: "cube-outline", plate: "card-outline" };

function FactChip({ fact }: { fact: VehicleFact }) {
  const tint = fact.tone === "good" ? colors.success : fact.tone === "bad" ? colors.danger : colors.mutedForeground;
  return (
    <View style={[styles.fact, fact.tone !== "neutral" && { backgroundColor: softTint(tint, fact.tone === "good" ? colors.successSoft : colors.dangerSoft), borderColor: "transparent" }]}>
      <Ionicons name={FACT_ICON[fact.key]} size={12} color={ink(tint)} style={fact.key === "heading" ? { transform: [{ rotate: `${(fact.headingDeg ?? 0) - 45}deg` }] } : undefined} />
      <Text style={[styles.factText, { color: fact.tone === "neutral" ? colors.foreground : ink(tint) }]} numberOfLines={1}>{fact.label}</Text>
    </View>
  );
}

/**
 * One vehicle as a card: a status-coloured edge and wash, the picture, name and status, where it
 * is, how fresh that is, the speed in its own box, and the facts the tracker sent.
 * Used by Overview, the Vehicles tab and the map's fleet list.
 */
export const VehicleRow = memo(function VehicleRow({ device, fmtSpeed, now, onPress }: { device: FleetDevice; fmtSpeed: (kph: number | null) => string; now: number; onPress: (deviceId: string) => void }) {
  const state = fleetState(device);
  const meta = STATE_META[state];
  const color = ink(meta.color);
  const moving = state === "moving";
  const [value, unit] = splitSpeed(state === "offline" || state === "never_seen" ? "—" : fmtSpeed(moving ? (device.location?.speedKph ?? null) : 0));
  const facts = vehicleFacts(device);
  return (
    <PressableScale onPress={() => onPress(device.deviceId)} style={styles.card} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${displayName(device)}, ${meta.label}`}>
      <LinearGradient colors={[colors.background, isDark ? colors.background : softTint(meta.color, meta.soft)]} start={{ x: 0.35, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.edge, { backgroundColor: color }]} />
      <View style={styles.top}>
        <VehiclePicture type={device.vehicle?.type} width={76} height={60} />
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>{displayName(device)}</Text>
            <StatusPill state={state} compact />
          </View>
          <View style={styles.line}>
            <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.lineText} numberOfLines={1}>{coordsText(device) ?? "No position yet"}</Text>
          </View>
          <View style={styles.line}>
            <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.lineText} numberOfLines={1}>{freshnessLine(device, now)}</Text>
          </View>
        </View>
        <View style={[styles.speed, { backgroundColor: softTint(meta.color, meta.soft) }]}>
          <Text style={[styles.speedValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
          {unit ? <Text style={styles.speedUnit}>{unit}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      {facts.length > 0 ? (
        <View style={styles.facts}>
          {facts.map((f) => (
            <FactChip key={f.key} fact={f} />
          ))}
        </View>
      ) : null}
    </PressableScale>
  );
});

/** "72 km/h" → ["72", "km/h"]; "—" → ["—", ""]. */
function splitSpeed(text: string): [string, string] {
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 3 },
  card: { height: ROW_HEIGHT - GAP, marginBottom: GAP, marginHorizontal: space.lg, paddingLeft: space.md + 5, paddingRight: space.sm, paddingVertical: 10, borderRadius: radius.xl + 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", justifyContent: "space-between", ...elevation.sm },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...type.rowTitle, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  line: { flexDirection: "row", alignItems: "center", gap: 5 },
  lineText: { ...type.small, flexShrink: 1, fontVariant: ["tabular-nums"] },
  speed: { minWidth: 56, paddingHorizontal: 6, paddingVertical: 6, borderRadius: radius.lg, alignItems: "center" },
  speedValue: { fontSize: 22, lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  speedUnit: { ...type.caption, color: colors.mutedForeground },
  facts: { flexDirection: "row", gap: 6, overflow: "hidden" },
  fact: { flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  factText: { fontSize: 12, lineHeight: 16, fontWeight: "600" }
});
