import { Ionicons } from "@expo/vector-icons";
import { checkPhone, displayPhone, formatNational, nationalDigits, PHONE_COUNTRIES, PHONE_EXAMPLE, type PhoneCountry } from "@rio-gps/core/phone";
import { useEffect, useState, type Ref } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, size, themed } from "../theme";

/**
 * Mobile number for Canada and the US (A44), the same rules as the website and the server
 * (@rio-gps/core/phone): +1 country chip (tap to switch), formats as you type, explains what's
 * wrong after you leave the field. The chip follows the area code once it's typed.
 */
export function PhoneField({
  label = "Mobile",
  value,
  onChangeText,
  error,
  ref,
  defaultCountry = "CA",
  ...input
}: { label?: string; value: string; onChangeText: (v: string) => void; error?: string | null; ref?: Ref<TextInput>; defaultCountry?: PhoneCountry } & Omit<TextInputProps, "value" | "onChangeText">) {
  const [country, setCountry] = useState<PhoneCountry>(defaultCountry);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const shown = show(value);
  const check = shown ? checkPhone(shown) : null;
  const detected = check?.ok ? check.country : null;
  useEffect(() => {
    if (detected && detected !== country) setCountry(detected);
  }, [detected, country]);
  const message = error ?? (touched && check && !check.ok ? check.error : null);
  const ok = Boolean(check?.ok) && !error;
  const flag = PHONE_COUNTRIES.find((c) => c.code === country)?.flag;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocused, message ? styles.boxError : ok ? styles.boxOk : null]}>
        <Pressable
          onPress={() => setCountry(country === "CA" ? "US" : "CA")}
          style={styles.country}
          accessibilityRole="button"
          accessibilityLabel={`Country: ${country === "CA" ? "Canada" : "United States"}. Tap to switch.`}
          hitSlop={4}
        >
          <Text style={styles.flag}>{flag}</Text>
          <Text style={styles.code}>+1</Text>
          <Ionicons name="swap-vertical" size={13} color={colors.mutedForeground} />
        </Pressable>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          value={shown}
          onChangeText={(t) => onChangeText(show(t))}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder={PHONE_EXAMPLE[country]}
          placeholderTextColor={colors.offline}
          maxLength={20}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            setTouched(true);
            input.onBlur?.(e);
          }}
          style={styles.input}
        />
        {ok ? <Ionicons name="checkmark-circle" size={20} color={colors.success} style={styles.end} /> : message ? <Ionicons name="alert-circle" size={20} color={colors.danger} style={styles.end} /> : null}
      </View>
      {message ? (
        <Text style={styles.error} accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

/** E.164 for a valid number (what the server stores), else null. */
export function phoneE164(v: string): string | null {
  const r = checkPhone(v);
  return r.ok ? r.e164 : null;
}

/** What's wrong with the number, or null when it's fine. */
export function phoneProblem(v: string): string | null {
  const r = checkPhone(v);
  return r.ok ? null : r.error;
}

function show(v: string): string {
  if (!v) return "";
  if (/^\+1\d{10}$/.test(v)) return displayPhone(v);
  if (v.trim().startsWith("+") && !v.replace(/\D/g, "").startsWith("1")) return v;
  return formatNational(nationalDigits(v));
}

const styles = themed(() => ({
  field: { gap: 6 },
  label: { fontSize: font.small, lineHeight: 18, fontWeight: "600", color: colors.foreground },
  box: { height: size.control, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, backgroundColor: colors.background, overflow: "hidden" },
  boxFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  boxError: { borderColor: colors.danger, borderWidth: 1.5 },
  boxOk: { borderColor: colors.success },
  country: { flexDirection: "row", alignItems: "center", gap: 4, height: "100%", paddingHorizontal: 12, backgroundColor: colors.muted, borderRightWidth: 1, borderRightColor: colors.border },
  flag: { fontSize: 18 },
  code: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  input: { flex: 1, height: "100%", paddingHorizontal: 12, fontSize: 16, color: colors.foreground },
  end: { marginRight: 12 },
  error: { fontSize: font.small, lineHeight: 18, fontWeight: "600", color: colors.danger }
}));
