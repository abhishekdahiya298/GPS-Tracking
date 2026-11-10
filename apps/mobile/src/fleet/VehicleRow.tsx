import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill, VehicleAvatar } from "../components/kit";
import { PressableScale } from "../components/motion";
import { colors, font, radius, space } from "../theme";
import { STATE_META, displayName, fleetState, statusLine, type FleetDevice } from "./model";

/** One vehicle in a list: picture, name, plate, what it is doing, status. Used by the Vehicles tab and the map's fleet list. */
export const VehicleRow = memo(function VehicleRow({ device, fmtSpeed, now, onPress }: { device: FleetDevice; fmtSpeed: (kph: number | null) => string; now: number; onPress: (deviceId: string) => void }) {
  const state = fleetState(device);
  return (
    <PressableScale onPress={() => onPress(device.deviceId)} style={styles.row} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${displayName(device)}, ${STATE_META[state].label}`}>
      <VehicleAvatar type={device.vehicle?.type} state={state} />
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>{displayName(device)}</Text>
          {device.vehicle?.licensePlate ? (
            <View style={styles.plate}>
              <Text style={styles.plateText} numberOfLines={1}>{device.vehicle.licensePlate}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.sub} numberOfLines={1}>{statusLine(device, fmtSpeed, now)}</Text>
      </View>
      <StatusPill state={state} compact />
      <Ionicons name="chevron-forward" size={16} color={colors.border} />
    </PressableScale>
  );
});

export const ROW_INSET = space.lg + 46 + space.md;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 72, backgroundColor: colors.background },
  nameLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colors.foreground },
  plate: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  plateText: { fontSize: 11, fontWeight: "600", color: colors.mutedForeground, letterSpacing: 0.3 },
  sub: { fontSize: font.small, color: colors.mutedForeground, marginTop: 3 }
});
