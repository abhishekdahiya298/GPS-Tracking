/**
 * The frame every sign-in and sign-up screen shares (W0, M1, S1–S3, D1, D1C): the navy band
 * with the fleet scene, the logo, a title, then one white card. Fits small phones and the keyboard.
 */
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomInset, useScreen } from "../layout";
import { colors, elevation, isDark, radius, space, themed, type } from "../theme";
import { FadeInUp } from "./motion";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../../assets/logo.png");
const HERO = require("../../assets/hero-signin.png");
const HERO_SHORT = require("../../assets/hero-reset.png");
const WAVES = require("../../assets/waves.png");
/* eslint-enable @typescript-eslint/no-require-imports */

export function AuthShell({ title, tagline, children, below, footer, back, cardKey }: { title: string; tagline?: string; children: ReactNode; below?: ReactNode; footer?: string | null; back?: boolean; cardKey?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { compact, width, height } = useScreen();
  const bottom = useBottomInset();
  const [brandHeight, setBrandHeight] = useState(0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const short = compact || height < 720;
  const heroHeight = Math.round((short ? 300 : 404) * (width / 390));
  // The card overlaps the bottom of the band by 18 pt.
  const gap = Math.max(space.lg, heroHeight - 18 - (insets.top + space.lg + brandHeight));
  const foot = footer === undefined ? `Version ${Constants.expoConfig?.version ?? ""} · app.riogps.com` : footer;

  return (
    <View style={styles.screen}>
      <Image source={short ? HERO_SHORT : HERO} style={[styles.hero, { height: heroHeight }]} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
      {typing ? null : <Image source={WAVES} style={[styles.waves, isDark && { opacity: 0.08 }]} resizeMode="stretch" accessibilityElementsHidden importantForAccessibility="no" />}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.lg, paddingBottom: space.xxl + bottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {back ? (
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={[styles.back, { top: insets.top + 6 }]}>
              <Ionicons name="chevron-back" size={24} color="#ffffff" />
            </Pressable>
          ) : null}
          <View onLayout={(e) => setBrandHeight(e.nativeEvent.layout.height)}>
            <FadeInUp style={styles.brand} distance={16}>
              <View style={styles.badge}>
                <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="RIO GPS" />
              </View>
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
              {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
            </FadeInUp>
          </View>
          <FadeInUp key={cardKey} index={1} distance={16} style={[styles.card, { marginTop: gap }]}>
            {children}
          </FadeInUp>
          {below ? <View style={styles.below}>{below}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {typing || !foot ? null : <Text style={[styles.version, { bottom: bottom + space.md }]}>{foot}</Text>}
    </View>
  );
}

/** Sign in | Create account, the same two tabs as the website. */
export function AuthTabs({ active }: { active: "signin" | "signup" }) {
  const router = useRouter();
  const tab = (key: "signin" | "signup", label: string, sub: string, icon: keyof typeof Ionicons.glyphMap) => {
    const on = active === key;
    return (
      <Pressable
        key={key}
        onPress={() => !on && router.replace(key === "signin" ? "/login" : "/signup")}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={[styles.tab, on && styles.tabOn]}
      >
        <View style={[styles.tabIcon, on ? styles.tabIconOn : null]}>
          <Ionicons name={icon} size={15} color={on ? "#ffffff" : colors.primary} />
        </View>
        <View style={styles.flexShrink}>
          <Text style={[styles.tabLabel, on && { color: "#ffffff" }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.tabSub, on && { color: "rgba(255,255,255,0.78)" }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {key === "signup" ? (
          <View style={styles.free}>
            <Text style={styles.freeText}>FREE</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tab("signin", "Sign in", "I have an account", "log-in-outline")}
      {tab("signup", "Create account", "Free, no card", "sparkles-outline")}
    </View>
  );
}

/** A tappable row card under the main card ("Driver? Sign in with your phone"). */
export function LinkCard({ icon, color, soft, title, detail, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string; title: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={detail ? `${title}. ${detail}` : title} style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.85 }]}>
      <View style={[styles.linkIcon, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={19} color={color} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.linkTitle}>{title}</Text>
        {detail ? <Text style={styles.linkDetail}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  hero: { position: "absolute", left: 0, right: 0, top: 0, width: "100%", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  waves: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 150 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl - 6 },
  back: { position: "absolute", left: space.md, zIndex: 2, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", gap: space.sm },
  badge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.lg, backgroundColor: "#ffffff", ...elevation.md },
  logo: { width: 104, height: 48 },
  title: { marginTop: space.xs, fontSize: 26, lineHeight: 32, fontWeight: "700", color: "#ffffff", textAlign: "center" },
  tagline: { maxWidth: 300, fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.82)", textAlign: "center" },
  card: { gap: space.md, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18, borderRadius: 20, backgroundColor: colors.background, ...elevation.lg },
  below: { marginTop: space.md, gap: space.sm },
  version: { ...type.caption, position: "absolute", left: 0, right: 0, textAlign: "center", color: isDark ? colors.mutedForeground : "#3d4a63" },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 16, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 12 },
  tabOn: { backgroundColor: "#133a9e", ...elevation.md },
  tabIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  tabIconOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  tabLabel: { fontSize: 13.5, fontWeight: "700", color: colors.foreground },
  tabSub: { fontSize: 11, color: colors.mutedForeground },
  free: { position: "absolute", right: 6, top: -8, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, backgroundColor: "#16a34a" },
  freeText: { fontSize: 10, fontWeight: "800", color: "#ffffff" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  linkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  linkTitle: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  linkDetail: { fontSize: 13, color: colors.mutedForeground }
}));
