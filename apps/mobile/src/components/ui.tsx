import type { Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, space } from "../theme";

export function Button({ title, onPress, loading, variant = "primary", disabled }: { title: string; onPress: () => void; loading?: boolean; variant?: "primary" | "ghost" | "danger"; disabled?: boolean }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && { backgroundColor: pressed ? colors.primaryDark : colors.primary },
        variant === "danger" && { backgroundColor: pressed ? colors.dangerSoft : colors.background, borderWidth: 1, borderColor: colors.danger },
        variant === "ghost" && { backgroundColor: pressed ? colors.muted : "transparent", minHeight: 40 },
        off && { opacity: 0.6 }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.primaryForeground : colors.primary} />
      ) : (
        <Text style={[styles.buttonText, variant === "ghost" && { color: colors.primary, fontWeight: "500" }, variant === "danger" && { color: colors.danger }]}>{title}</Text>
      )}
    </Pressable>
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
  button: { minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  buttonText: { color: colors.primaryForeground, fontSize: font.body, fontWeight: "600" },
  field: { gap: space.xs },
  label: { fontSize: font.small, fontWeight: "500", color: colors.foreground },
  // 16px text: iOS zooms the screen on focus for anything smaller.
  input: { minHeight: 48, borderWidth: 1, borderColor: "#d4d8df", borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, color: colors.foreground, backgroundColor: colors.background },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md },
  errorText: { color: colors.danger, fontSize: font.small, lineHeight: 19 }
});
