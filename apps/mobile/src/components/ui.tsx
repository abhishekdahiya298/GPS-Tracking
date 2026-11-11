import { useState, type Ref } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, size, space } from "../theme";
import { PressableScale } from "./motion";

type IconName = keyof typeof Ionicons.glyphMap;

export function Button({ title, onPress, loading, variant = "primary", disabled, icon, compact }: { title: string; onPress: () => void; loading?: boolean; variant?: "primary" | "ghost" | "danger" | "outline"; disabled?: boolean; icon?: IconName; compact?: boolean }) {
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
        compact && styles.compact,
        variant === "primary" && styles.primary,
        variant === "danger" && { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
        variant === "outline" && { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong },
        variant === "ghost" && { backgroundColor: "transparent", minHeight: size.controlSm, paddingHorizontal: space.sm },
        off && { opacity: 0.55 }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
          <Text style={[styles.buttonText, compact && { fontSize: 14 }, { color: tint }]} numberOfLines={1}>{title}</Text>
        </>
      )}
    </PressableScale>
  );
}

/** A labelled text field. `icon` sits at the start; a password field gets an eye to show what was typed. */
export function Field({ label, ref, secureTextEntry, icon, ...input }: { label: string; ref?: Ref<TextInput>; icon?: IconName } & TextInputProps) {
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.offline}
          secureTextEntry={secureTextEntry && !shown}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, icon && styles.inputWithIcon, secureTextEntry && styles.inputWithEye, focused && styles.inputFocused, input.style]}
        />
        {icon ? (
          <View style={styles.lead} pointerEvents="none">
            <Ionicons name={icon} size={size.icon} color={focused ? colors.primary : colors.mutedForeground} />
          </View>
        ) : null}
        {secureTextEntry ? (
          <Pressable onPress={() => setShown(!shown)} style={styles.eye} hitSlop={8} accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"}>
            <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={size.icon} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: size.control, borderRadius: radius.lg, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  compact: { minHeight: size.controlSm, paddingHorizontal: space.md },
  primary: { backgroundColor: colors.primary },
  buttonText: { fontSize: font.body, lineHeight: 20, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: font.small, lineHeight: 18, fontWeight: "600", color: colors.foreground },
  // 16px text: iOS zooms the screen on focus for anything smaller.
  input: { height: size.control, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 0, fontSize: 16, color: colors.foreground, backgroundColor: colors.background },
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  inputWithIcon: { paddingLeft: 44 },
  inputWithEye: { paddingRight: 48 },
  lead: { position: "absolute", left: 14, top: 0, bottom: 0, justifyContent: "center" },
  eye: { position: "absolute", right: 2, top: 0, bottom: 0, width: 44, alignItems: "center", justifyContent: "center" },
  error: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md },
  errorText: { flex: 1, color: colors.danger, fontSize: font.small, lineHeight: 18 }
});
