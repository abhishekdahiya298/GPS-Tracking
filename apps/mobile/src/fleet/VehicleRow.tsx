import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill, VehicleAvatar } from "../components/kit";
import { PressableScale } from "../components/motion";
import { colors, font, radius, size, space, type } from "../theme";
import { STATE_META, displayName, fleetState, statusLine, type FleetDevice } from "./model";

/** The height of one row. Lists use it to place rows without measuring them, which keeps scrolling fast. */
export const ROW_HEIGHT = size.row + 4;
/** Where the hairline between rows starts: after the picture. */
export const ROW_INSET = space.md + size.well + space.md;

/** One vehicle in a list: picture, name, plate, what it is doing, status. Used by Home, the Vehicles tab and the map's fleet list. */
export const VehicleRow = memo(function VehicleRow({ device, fmtSpeed, now, onPress }: { device: FleetDevice; fmtSpeed: (kph: number | null) => string; now: number; onPress: (deviceId: string) => void }) {
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

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, height: ROW_HEIGHT, backgroundColor: colors.background },
  subLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  plate: { flexShrink: 0, paddingHorizontal: 5, borderRadius: radius.sm - 1, borderWidth: 1, borderColor: colors.border },
  plateText: { fontSize: 11, lineHeight: 16, fontWeight: "600", color: colors.mutedForeground },
  sub: { flexShrink: 1, fontSize: font.small, lineHeight: 18, color: colors.mutedForeground, fontVariant: ["tabular-nums"] }
});
