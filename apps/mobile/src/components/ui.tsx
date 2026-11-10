import type { Ref } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, elevation, font, radius, space } from "../theme";
import { PressableScale } from "./motion";

export function Button({ title, onPress, loading, variant = "primary", disabled, icon }: { title: string; onPress: () => void; loading?: boolean; variant?: "primary" | "ghost" | "danger" | "outline"; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap }) {
  const off = disabled || loading;
  const tint = variant === "primary" ? colors.primaryForeground : variant === "danger" ? colors.danger : colors.primary;
  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      feedback={variant === "primary" ? "press" : "tap"}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[
        styles.button,
        variant === "primary" && styles.primary,
        variant === "danger" && { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.danger },
        variant === "outline" && { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
        variant === "ghost" && { backgroundColor: "transparent", minHeight: 40 },
        off && { opacity: 0.6 }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
          <Text style={[styles.buttonText, { color: tint }, variant === "ghost" && { fontWeight: "600" }]}>{title}</Text>
        </>
      )}
    </PressableScale>
  );
}

export function Field({ label, ref, ...input }: { label: string; ref?: Ref<TextInput> } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={colors.offline} {...input} style={[styles.input, input.style]} />
    </View>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radius.xl, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  primary: { backgroundColor: colors.primary, ...elevation.sm },
  buttonText: { color: colors.primaryForeground, fontSize: font.body, fontWeight: "600" },
  field: { gap: space.xs },
  label: { fontSize: font.small, fontWeight: "500", color: colors.foreground },
  // 16px text: iOS zooms the screen on focus for anything smaller.
  input: { minHeight: 50, borderWidth: 1, borderColor: "#d4d8df", borderRadius: radius.xl, paddingHorizontal: space.md, fontSize: 16, color: colors.foreground, backgroundColor: colors.background },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md },
  errorText: { color: colors.danger, fontSize: font.small, lineHeight: 19 }
});
