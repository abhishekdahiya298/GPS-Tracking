import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill, VehiclePicture } from "../components/kit";
import { PressableScale } from "../components/motion";
import { colors, elevation, ink, isDark, radius, softTint, space, type, themed } from "../theme";
import { useAddress } from "@/map/useAddress";
import { STATE_META, coordsText, displayName, fleetState, freshnessLine, vehicleFacts, type FleetDevice } from "./model";

/** Gap under each card. */
const GAP = 10;
/** The height a card takes in a list, gap included. Lists place cards without measuring them. */
export const ROW_HEIGHT = 92 + GAP;
/** Kept for lists that still draw hairlines; cards don't need them. */
export const ROW_INSET = 0;

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
  // The street address (from the server, cached); the coordinates show until it arrives.
  const address = useAddress(device.location?.latitude, device.location?.longitude, moving);
  const ignition = facts.find((f) => f.key === "ignition");
  return (
    <PressableScale onPress={() => onPress(device.deviceId)} style={styles.card} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${displayName(device)}, ${meta.label}`}>
      <LinearGradient colors={[colors.background, isDark ? colors.background : softTint(meta.color, meta.soft)]} start={{ x: 0.05, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.edge, { backgroundColor: color }]} />
      <VehiclePicture type={device.vehicle?.type} state={state} width={68} height={50} />
      {/* The name gets the whole first line; status and freshness sit under it, then where it is. */}
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{displayName(device)}</Text>
        <View style={styles.line}>
          <StatusPill state={state} compact />
          <Text style={styles.lineText} numberOfLines={1}>{freshnessLine(device, now).replace(/^Updated /, "")}</Text>
        </View>
        <View style={styles.line}>
          <Ionicons name="location-outline" size={13} color={colors.mutedForeground} />
          <Text style={styles.lineText} numberOfLines={1}>{address?.label ?? address?.line1 ?? coordsText(device) ?? "No position yet"}</Text>
          {ignition ? <Ionicons name="power" size={12} color={ink(ignition.tone === "good" ? colors.success : colors.danger)} accessibilityLabel={ignition.label} /> : null}
        </View>
      </View>
      <View style={[styles.speed, { backgroundColor: softTint(meta.color, meta.soft) }]}>
        <Text style={[styles.speedValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        {unit ? <Text style={styles.speedUnit}>{unit}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </PressableScale>
  );
});

/** "72 km/h" → ["72", "km/h"]; "—" → ["—", ""]. */
function splitSpeed(text: string): [string, string] {
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
}

const styles = themed(() => ({
  flex: { flex: 1, minWidth: 0, gap: 3 },
  card: { height: ROW_HEIGHT - GAP, marginBottom: GAP, marginHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: space.md + 2, paddingRight: space.sm, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden", ...elevation.sm },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  name: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: colors.foreground },
  line: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  lineText: { ...type.caption, flexShrink: 1, fontVariant: ["tabular-nums"] },
  speed: { width: 54, paddingVertical: 5, borderRadius: radius.lg, alignItems: "center" },
  speedValue: { fontSize: 20, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  speedUnit: { fontSize: 11, lineHeight: 14, color: colors.mutedForeground }
}));
