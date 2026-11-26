/**
 * The frame every sign-in and sign-up screen shares (MD01 › Sign in and sign up screens):
 * a blue banner with the logo, a title with one yellow italic word and a picture by role (the
 * driver photo on driver screens, the truck for fleets and brokers), then one white card that
 * overlaps the banner. Fits small phones and the keyboard. Entrances animate on the native driver.
 */
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { useBottomInset } from "../layout";
import { colors, elevation, isDark, space, themed } from "../theme";
import { FadeInUp, PressableScale } from "./motion";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const WAVES = require("../../assets/waves.png");
export const AUTH_IMAGES = { truck: require("../../assets/auth-truck.jpg"), driver: require("../../assets/auth-driver.jpg"), fleet: require("../../assets/auth-fleet.jpg") };
/* eslint-enable @typescript-eslint/no-require-imports */

export const DRIVER_TONE = { main: "#ea580c", top: "#f97316", soft: "#fff3e6", border: "#f8c99a", ink: "#7c2d12" };
export const FLEET_TONE = { main: "#1d4ed8", top: "#2563eb", soft: "#eef3fb", border: "#9db6ea", ink: "#0a1f5c" };
export type Tone = typeof DRIVER_TONE;
const NAVY = "#0a1f5c";

export function AuthShell({
  title,
  accent,
  tagline,
  children,
  below,
  footer,
  back,
  cardKey,
  photo = "truck"
}: {
  title: string;
  /** The second title line, in yellow italics. */
  accent?: string;
  tagline?: string;
  children: ReactNode;
  below?: ReactNode;
  /** null hides the footer line. */
  footer?: string | null;
  back?: boolean;
  cardKey?: string;
  photo?: "truck" | "driver" | "none";
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottom = useBottomInset();
  const [typing, setTyping] = useState(false);
  const [bannerH, setBannerH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // The photo glides in from the right and the banner settles once, when the screen opens.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter]);

  return (
    <View style={styles.screen}>
      {typing ? null : <Image source={WAVES} style={[styles.waves, isDark && { opacity: 0.08 }]} resizeMode="stretch" accessibilityElementsHidden importantForAccessibility="no" />}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.xxl + bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <View onLayout={(e: LayoutChangeEvent) => setBannerH(e.nativeEvent.layout.height)} style={[styles.banner, { paddingTop: insets.top + 8 }]}>
            <LinearGradient colors={["#0a2a86", "#1446c4", "#2f6bea"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheetFill} />
            {photo !== "none" && bannerH > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.photoWrap, { top: insets.top + 36, height: bannerH - insets.top - 36, opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}
              >
                <Image source={photo === "driver" ? AUTH_IMAGES.driver : AUTH_IMAGES.truck} style={styles.photo} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
                <LinearGradient colors={["#1446c4", "rgba(20,70,196,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 0.55, y: 0.5 }} style={StyleSheetFill} />
                <LinearGradient colors={["#0f3aa8", "rgba(15,58,168,0)"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.3 }} style={StyleSheetFill} />
              </Animated.View>
            ) : null}
            <View style={styles.topRow}>
              {back ? (
                <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
                  <Ionicons name="chevron-back" size={22} color="#ffffff" />
                </Pressable>
              ) : (
                <View style={styles.backSpace} />
              )}
              <View style={styles.badge}>
                <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
              </View>
              <View style={styles.backSpace} />
            </View>
            <FadeInUp distance={14} style={[styles.titleBox, photo === "none" && { maxWidth: "100%" }]}>
              <Text style={styles.title} accessibilityRole="header">
                {title}
                {accent ? "\n" : ""}
                {accent ? <Text style={styles.accent}>{accent}</Text> : null}
              </Text>
              {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
            </FadeInUp>
          </View>
          <FadeInUp key={cardKey} index={1} distance={18} style={styles.card}>
            {children}
          </FadeInUp>
          {below ? <View style={styles.below}>{below}</View> : null}
          {typing || footer === null ? null : (
            <View style={styles.foot}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.primary} />
              <Text style={styles.footText}>{footer ?? "Your information is secure with us."}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const StyleSheetFill = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };

/** "Fleet or broker | Driver": the thumb slides to the side that is on. */
export function RoleSwitch({ active, onChange }: { active: "fleet" | "driver"; onChange: (to: "fleet" | "driver") => void }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(active === "driver" ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: active === "driver" ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
  }, [active, x]);
  const half = (w - 8) / 2;
  const seg = (key: "fleet" | "driver", label: string, icon: keyof typeof Ionicons.glyphMap, color: string) => {
    const on = active === key;
    return (
      <Pressable
        key={key}
        onPress={() => {
          if (on) return;
          haptic.tap();
          onChange(key);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={styles.seg}
      >
        <Ionicons name={icon} size={16} color={on ? color : colors.mutedForeground} />
        <Text style={[styles.segText, { color: on ? color : colors.mutedForeground }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.switch} accessibilityRole="tablist" onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? <Animated.View style={[styles.thumb, { width: half, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, half] }) }] }]} /> : null}
      {seg("fleet", "Fleet or broker", "grid-outline", FLEET_TONE.main)}
      {seg("driver", "Driver", "car-outline", DRIVER_TONE.main)}
    </View>
  );
}

/** The main action: a round button with a white arrow circle. */
export function ArrowButton({ title, onPress, tone = FLEET_TONE, loading, disabled }: { title: string; onPress: () => void; tone?: Tone; loading?: boolean; disabled?: boolean }) {
  const off = disabled || loading;
  return (
    <PressableScale onPress={onPress} disabled={off} feedback="press" accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!loading }} style={[styles.arrowBtn, { shadowColor: tone.main }, off && { opacity: 0.6 }]}>
      <LinearGradient colors={[tone.top, tone.main]} style={[StyleSheetFill, { borderRadius: 999 }]} />
      <View style={styles.arrowCircle}>{loading ? <ActivityIndicator color={tone.main} size="small" /> : <Ionicons name="arrow-forward" size={18} color={tone.main} />}</View>
      <Text style={styles.arrowText} numberOfLines={1}>
        {title}
      </Text>
    </PressableScale>
  );
}

/** The second action: an outline round button. */
export function OutlineButton({ title, icon, onPress, tone = FLEET_TONE, badge }: { title: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; tone?: Tone; badge?: string }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={[styles.outline, { borderColor: tone.border }]}>
      {icon ? <Ionicons name={icon} size={18} color={tone.main} /> : null}
      <Text style={[styles.outlineText, { color: tone.main }]}>{title}</Text>
      {badge ? (
        <View style={styles.badgeGreen}>
          <Text style={styles.badgeGreenText}>{badge}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Steps of a short flow (3 dots); the current one grows. */
export function StepDots({ step, of = 3, tone = FLEET_TONE }: { step: number; of?: number; tone?: Tone }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Step ${step} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={[styles.dot, i < step && { width: 30, backgroundColor: tone.main }]} />
      ))}
    </View>
  );
}

/** A tinted tip box. */
export function Note({ icon = "shield-checkmark-outline", text, tone = FLEET_TONE, bold }: { icon?: keyof typeof Ionicons.glyphMap; text: string; tone?: Tone; bold?: string }) {
  return (
    <View style={[styles.note, { backgroundColor: tone.soft }]}>
      <Ionicons name={icon} size={17} color={tone.ink} />
      <Text style={[styles.noteText, { color: tone.ink }]}>
        {bold ? <Text style={{ fontWeight: "700" }}>{bold} </Text> : null}
        {text}
      </Text>
    </View>
  );
}

/**
 * Six code boxes over one hidden input (paste and the phone's one-time-code fill work). Each digit
 * pops in. `filling` types a code in digit by digit (test numbers).
 */
export function CodeBoxes({ value, onChange, tone = FLEET_TONE, autoFocus }: { value: string; onChange: (v: string) => void; tone?: Tone; autoFocus?: boolean }) {
  const input = useRef<TextInput>(null);
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
      <View style={styles.codeRow}>
        {Array.from({ length: 6 }, (_, i) => (
          <CodeBox key={i} digit={value[i] ?? ""} current={i === Math.min(value.length, 5)} tone={tone} />
        ))}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={6}
        accessibilityLabel="6-digit code"
        style={styles.hiddenInput}
        caretHidden
      />
    </Pressable>
  );
}
function CodeBox({ digit, current, tone }: { digit: string; current: boolean; tone: Tone }) {
  const pop = useRef(new Animated.Value(digit ? 1 : 0)).current;
  useEffect(() => {
    if (!digit) return void pop.setValue(0);
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 12 }).start();
  }, [digit, pop]);
  return (
    <View style={[styles.codeBox, current && { borderColor: tone.main, borderWidth: 2 }]}>
      <Animated.Text style={[styles.codeDigit, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>{digit}</Animated.Text>
    </View>
  );
}

/** Kept for screens that still use them (create account steps). */
export function AuthTabs({ active }: { active: "signin" | "signup" }) {
  const router = useRouter();
  return (
    <RoleLikeTabs
      items={[
        { key: "signin", label: "Sign in", icon: "log-in-outline" },
        { key: "signup", label: "Create account", icon: "sparkles-outline" }
      ]}
      active={active}
      onChange={(k) => router.replace(k === "signin" ? "/login" : "/signup")}
    />
  );
}
function RoleLikeTabs({ items, active, onChange }: { items: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[]; active: string; onChange: (k: string) => void }) {
  return (
    <View style={styles.switch} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Pressable key={it.key} onPress={() => !on && onChange(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.seg, on && styles.segOn]}>
            <Ionicons name={it.icon} size={16} color={on ? FLEET_TONE.main : colors.mutedForeground} />
            <Text style={[styles.segText, { color: on ? FLEET_TONE.main : colors.mutedForeground }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tappable row card under the main card. */
export function LinkCard({ icon, color, soft, title, detail, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string; title: string; detail?: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={detail ? `${title}. ${detail}` : title} style={styles.linkCard}>
      <View style={[styles.linkIcon, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={19} color={color} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.linkTitle}>{title}</Text>
        {detail ? <Text style={styles.linkDetail}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: isDark ? colors.canvas : "#eef3fb" },
  flex: { flex: 1 },
  waves: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 130 },
  scroll: { flexGrow: 1 },
  banner: { minHeight: 236, paddingHorizontal: 20, paddingBottom: 44, overflow: "hidden" },
  photoWrap: { position: "absolute", right: -6, width: "44%", overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  backSpace: { width: 38, height: 38 },
  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: "#ffffff", ...elevation.md },
  logo: { width: 80, height: 36 },
  titleBox: { marginTop: 18, maxWidth: "60%", gap: 6 },
  title: { fontSize: 25, lineHeight: 30, fontWeight: "800", color: "#ffffff", letterSpacing: -0.4 },
  accent: { fontSize: 30, lineHeight: 36, fontWeight: "900", fontStyle: "italic", color: "#fbbf24" },
  tagline: { fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.92)" },
  card: { marginTop: -28, marginHorizontal: 12, gap: space.md, padding: 14, paddingBottom: 16, borderRadius: 24, backgroundColor: colors.background, ...elevation.lg },
  below: { marginTop: space.md, marginHorizontal: 12, gap: space.sm },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: space.md, paddingHorizontal: space.lg },
  footText: { fontSize: 12, color: isDark ? colors.mutedForeground : "#1e3a8a", textAlign: "center" },
  switch: { flexDirection: "row", padding: 4, borderRadius: 999, backgroundColor: isDark ? colors.muted : "#e8eef8" },
  thumb: { position: "absolute", left: 4, top: 4, bottom: 4, borderRadius: 999, backgroundColor: colors.background, ...elevation.md },
  seg: { flex: 1, height: 40, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  segOn: { backgroundColor: colors.background, ...elevation.md },
  segText: { fontSize: 13.5, fontWeight: "700" },
  arrowBtn: { height: 52, borderRadius: 999, flexDirection: "row", alignItems: "center", paddingLeft: 7, paddingRight: 18, overflow: "hidden", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  arrowCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  arrowText: { flex: 1, marginRight: 30, textAlign: "center", fontSize: 15.5, fontWeight: "700", color: "#ffffff" },
  outline: { height: 50, borderRadius: 999, borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: colors.background },
  outlineText: { fontSize: 15, fontWeight: "700" },
  badgeGreen: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: "#dcf3e4" },
  badgeGreenText: { fontSize: 11, fontWeight: "700", color: "#0f5c2c" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 4 },
  dot: { width: 22, height: 4, borderRadius: 4, backgroundColor: isDark ? colors.border : "#dbe4f8" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 11, borderRadius: 14 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  codeRow: { flexDirection: "row", gap: 7 },
  codeBox: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: isDark ? colors.border : "#cfdaee", backgroundColor: isDark ? colors.muted : "#f8fbff", alignItems: "center", justifyContent: "center" },
  codeDigit: { fontSize: 24, fontWeight: "800", color: isDark ? colors.foreground : NAVY },
  hiddenInput: { position: "absolute", opacity: 0.02, width: "100%", height: 56, color: "transparent" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  linkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  linkTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  linkDetail: { fontSize: 13, color: colors.mutedForeground }
}));
