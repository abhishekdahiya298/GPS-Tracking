import { Image, StyleSheet, Text, View } from "react-native";
import { Card, Segmented } from "@/components/kit";
import { PressableScale } from "@/components/motion";
import { haptic } from "@/haptics";
import { colors, radius, space, type } from "@/theme";
import { setIconPrefs, useIconPrefs } from "./iconPrefs";
import { iconName, type IconStyle } from "./model";
import { MAP_ICONS } from "./sprites";

const STYLES: ReadonlyArray<{ value: IconStyle; label: string }> = [
  { value: "pin", label: "3D pin" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "top", label: "From above" }
];

/** Account → Map icons: how vehicles look on the maps. Kept on this phone; the map redraws at once. */
export function MapIconPicker() {
  const prefs = useIconPrefs();
  return (
    <Card style={styles.card}>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Map icon style">
        {STYLES.map((s) => {
          const on = prefs.style === s.value;
          const img = MAP_ICONS[iconName("truck", "moving", { style: s.value, color: prefs.color })];
          return (
            <PressableScale
              key={s.value}
              onPress={() => {
                haptic.tap();
                setIconPrefs({ style: s.value });
              }}
              scaleTo={0.95}
              outerStyle={styles.slot}
              style={[styles.option, on && styles.optionOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={s.label}
            >
              <View style={styles.preview}>{img ? <Image source={img} style={s.value === "top" ? styles.top : s.value === "pin" ? styles.pin : styles.round} resizeMode="contain" /> : null}</View>
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{s.label}</Text>
            </PressableScale>
          );
        })}
      </View>
      {prefs.style !== "top" ? (
        <Segmented
          label="Icon colour"
          value={prefs.color}
          onChange={(color) => setIconPrefs({ color })}
          options={[
            { value: "status", label: "By status" },
            { value: "type", label: "By vehicle type" }
          ]}
        />
      ) : null}
      <Text style={type.caption}>Vehicles show as status dots only when the whole continent is in view. The small badge always shows the status.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: "row", gap: space.sm },
  slot: { flex: 1 },
  option: { alignItems: "center", gap: 4, paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.muted },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  preview: { height: 52, alignItems: "center", justifyContent: "center" },
  pin: { width: 40, height: 50 },
  round: { width: 42, height: 46 },
  top: { width: 30, height: 48 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: colors.mutedForeground },
  labelOn: { color: colors.primary, fontWeight: "700" }
});
