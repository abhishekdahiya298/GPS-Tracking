import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill, VehicleAvatar } from "../components/kit";
import { PressableScale } from "../components/motion";
import { colors, elevation, font, ink, radius, size, space, themed, type } from "../theme";
import { STATE_META, compassPoint, displayName, fleetState, statusLine, timeAgo, type FleetDevice, type FleetState } from "./model";

/** The height of one row. Lists use it to place rows without measuring them, which keeps scrolling fast. */
export const ROW_HEIGHT = size.row + 4;
/** Where the hairline between rows starts: after the picture. */
export const ROW_INSET = space.md + size.well + space.md;
/** One vehicle card and the gap under it. Fixed, so long lists never have to measure a card. */
export const CARD_HEIGHT = 84;
export const CARD_GAP = 10;

type RowProps = { device: FleetDevice; fmtSpeed: (kph: number | null) => string; now: number; onPress: (deviceId: string) => void };

/** One vehicle as a compact row: picture, name, plate, what it is doing, status. Used by the map's fleet list. */
export const VehicleRow = memo(function VehicleRow({ device, fmtSpeed, now, onPress }: RowProps) {
  const state = fleetState(device);
  return (
    <PressableScale onPress={() => onPress(device.deviceId)} style={styles.row} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${displayName(device)}, ${STATE_META[state].label}`}>
      <VehicleAvatar type={device.vehicle?.type} state={state} />
      <View style={styles.flex}>
        <Text style={type.rowTitle} numberOfLines={1}>{displayName(device)}</Text>
        <View style={styles.subLine}>
          {device.vehicle?.licensePlate ? (
            <View style={styles.plate}>
              <Text style={styles.plateText} numberOfLines={1}>{device.vehicle.licensePlate}</Text>
            </View>
          ) : null}
          <Text style={styles.sub} numberOfLines={1}>{statusLine(device, fmtSpeed, now)}</Text>
        </View>
      </View>
      <StatusPill state={state} compact />
    </PressableScale>
  );
});

/** The short reading on the right of a card: speed while moving, otherwise how fresh the last report is. */
function reading(device: FleetDevice, state: FleetState, fmtSpeed: (kph: number | null) => string, now: number): { main: string; note: string } {
  if (state === "moving") {
    const point = compassPoint(device.location?.headingDeg ?? null);
    return { main: fmtSpeed(device.location?.speedKph ?? null), note: point ? `Heading ${point}` : "On the road" };
  }
  if (state === "never_seen") return { main: "—", note: "No report yet" };
  const fresh = timeAgo(state === "offline" || state === "parked" ? device.lastSeenAt : (device.location?.recordedAt ?? device.lastSeenAt), now);
  return { main: fresh, note: state === "idle" ? "Engine on" : state === "stopped" ? "Engine off" : state === "parked" ? "Unhooked" : "Last seen" };
}

/**
 * One vehicle as a card: a raised picture in the status colour, the name and plate, the status,
 * and one reading (speed or last report). Used by Home and the Vehicles tab.
 */
export const VehicleCard = memo(function VehicleCard({ device, fmtSpeed, now, onPress }: RowProps) {
  const state = fleetState(device);
  const meta = STATE_META[state];
  const kind = device.vehicle?.type;
  const read = reading(device, state, fmtSpeed, now);
  return (
    <PressableScale onPress={() => onPress(device.deviceId)} style={styles.card} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`${displayName(device)}, ${meta.label}, ${read.main}`}>
      <View style={[styles.accent, { backgroundColor: ink(meta.color) }]} />
      <VehicleAvatar type={kind} state={state} size={48} />
      <View style={styles.flex}>
        <Text style={styles.cardName} numberOfLines={1}>{displayName(device)}</Text>
        <View style={styles.subLine}>
          {device.vehicle?.licensePlate ? (
            <View style={styles.plate}>
              <Text style={styles.plateText} numberOfLines={1}>{device.vehicle.licensePlate}</Text>
            </View>
          ) : null}
          <Text style={styles.sub} numberOfLines={1}>{read.note}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <StatusPill state={state} compact />
        <Text style={[styles.reading, state === "moving" && { color: ink(meta.color) }]} numberOfLines={1}>{read.main}</Text>
      </View>
    </PressableScale>
  );
});

const styles = themed(() => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: ROW_HEIGHT, backgroundColor: colors.background },
  subLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  plate: { flexShrink: 0, paddingHorizontal: 5, borderRadius: radius.sm - 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  plateText: { fontSize: 11, lineHeight: 16, fontWeight: "600", color: colors.mutedForeground },
  sub: { flexShrink: 1, fontSize: font.small, lineHeight: 18, color: colors.mutedForeground, fontVariant: ["tabular-nums"] },
  card: { flexDirection: "row", alignItems: "center", gap: space.md, height: CARD_HEIGHT, paddingLeft: space.lg, paddingRight: space.md, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, overflow: "hidden", ...elevation.sm },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardName: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: colors.foreground },
  right: { alignItems: "flex-end", gap: 5, flexShrink: 0 },
  reading: { fontSize: font.small, lineHeight: 18, fontWeight: "700", color: colors.foreground, fontVariant: ["tabular-nums"] }
}));
