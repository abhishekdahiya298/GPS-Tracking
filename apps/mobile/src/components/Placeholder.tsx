import type { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors } from "../theme";
import { EmptyState } from "./kit";

/** A screen that can't show its content here (the map inside Expo Go): says why. */
export function Placeholder({ icon, title, note }: { icon: keyof typeof Ionicons.glyphMap; title: string; note: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <EmptyState icon={icon} tone="brand" title={title} note={note} />
    </View>
  );
}
