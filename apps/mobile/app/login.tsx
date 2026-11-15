import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { codeFailure, signInMessage, type CodeKind } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { FadeInUp } from "@/components/motion";
import { Button, ErrorNote, Field } from "@/components/ui";
import { useBottomInset, useScreen } from "@/layout";
import { colors, elevation, ink, isDark, radius, softTint, space, type } from "@/theme";
import { STATE_META } from "@/fleet/model";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const LOGO = require("../assets/logo.png");
/** Navy band with a dusk fleet scene (drawn from assets/art/hero-signin.svg). 390×404 at 1×. */
const HERO = require("../assets/hero-signin.png");
/** The same band without the scene, for short phones. 390×300. */
const HERO_SHORT = require("../assets/hero-reset.png");
const WAVES = require("../assets/waves.png");
/* eslint-enable @typescript-eslint/no-require-imports */

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, verifyCode } = useSession();
  const [brandHeight, setBrandHeight] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Set only while the second step is open. Kept in memory, never stored.
  const [pending, setPending] = useState<string | null>(null);
  const [kind, setKind] = useState<CodeKind>("app");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const { compact, width, height } = useScreen();
  // The picture along the bottom shows only when there is room for it: a tall phone, keyboard closed.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setTyping(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const bottom = useBottomInset();
  // The band scales with the phone's width. A short phone gets the band without the scene,
  // so the whole form still fits above the keyboard.
  const short = compact || height < 720;
  const heroHeight = Math.round((short ? 300 : 404) * (width / 390));
  // The form card overlaps the bottom of the band by 18 pt.
  const gap = Math.max(
    space.lg,
    heroHeight - 18 - (insets.top + space.lg + brandHeight),
  );

  function startAgain(message: string | null = null) {
    setPending(null);
    setCode("");
    setKind("app");
    setPassword("");
    setError(message);
  }

  async function onSignIn() {
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.step === "code") {
        setPending(result.pending);
        setCode("");
      }
    } catch (e) {
      setError(signInMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (busy || !pending) return;
    if (!code.trim()) {
      setError(
        kind === "backup" ? "Enter a backup code." : "Enter the 6-digit code.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await verifyCode(pending, code, kind);
    } catch (e) {
      const failure = codeFailure(e, kind);
      if (failure.restart) startAgain(failure.message);
      else setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Image
        source={short ? HERO_SHORT : HERO}
        style={[styles.hero, { height: heroHeight }]}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {typing ? null : (
        <Image
          source={WAVES}
          style={[styles.waves, isDark && styles.wavesDark]}
          resizeMode="stretch"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + space.lg,
              paddingBottom: space.lg + bottom,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View onLayout={(e) => setBrandHeight(e.nativeEvent.layout.height)}>
            <FadeInUp style={styles.brand} distance={16}>
              <View style={styles.badge}>
                <Image
                  source={LOGO}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel="RIO GPS"
                />
              </View>
              <Text style={styles.title} accessibilityRole="header">
                {pending ? "Two-step verification" : "Welcome back"}
              </Text>
              <Text style={styles.tagline}>
                {pending
                  ? kind === "backup"
                    ? "Enter one of the backup codes you saved when you turned on two-step verification."
                    : "Enter the 6-digit code from your authenticator app."
                  : "Track your trucks, trailers and assets, live, in one place."}
              </Text>
            </FadeInUp>
          </View>

          <FadeInUp
            key={pending ? "code" : "password"}
            index={1}
            distance={16}
            style={[styles.card, { marginTop: gap }]}
          >
            {pending ? (
              <>
                <Field
                  key={kind}
                  label={
                    kind === "backup" ? "Backup code" : "Verification code"
                  }
                  icon="shield-checkmark-outline"
                  value={code}
                  onChangeText={setCode}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={kind === "backup" ? "default" : "number-pad"}
                  textContentType={kind === "backup" ? "none" : "oneTimeCode"}
                  autoComplete={kind === "backup" ? "off" : "one-time-code"}
                  maxLength={kind === "backup" ? 32 : 7}
                  returnKeyType="done"
                  onSubmitEditing={onVerify}
                  style={styles.code}
                />
                {error && <ErrorNote text={error} />}
                <Button
                  title="Verify"
                  onPress={onVerify}
                  loading={busy}
                  icon="shield-checkmark-outline"
                />
                <View style={styles.links}>
                  <Button
                    variant="ghost"
                    title={
                      kind === "backup"
                        ? "Use the authenticator app"
                        : "Use a backup code"
                    }
                    onPress={() => {
                      setError(null);
                      setCode("");
                      setKind(kind === "backup" ? "app" : "backup");
                    }}
                    disabled={busy}
                  />
                  <Button
                    variant="ghost"
                    title="Start again"
                    onPress={() => startAgain()}
                    disabled={busy}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Sign in to your account</Text>
                <Field
                  label="Email"
                  hideLabel
                  icon="mail-outline"
                  placeholder="you@company.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <Field
                  ref={passwordRef}
                  label="Password"
                  hideLabel
                  icon="lock-closed-outline"
                  placeholder="Your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={onSignIn}
                />
                <Pressable
                  onPress={() => router.push("/forgot")}
                  hitSlop={8}
                  style={styles.forgot}
                  accessibilityRole="link"
                >
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
                {error && <ErrorNote text={error} />}
                <Button
                  title="Sign in"
                  onPress={onSignIn}
                  loading={busy}
                  icon="arrow-forward"
                />
              </>
            )}
          </FadeInUp>

          {pending || compact ? null : (
            <View
              style={styles.features}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.featureHead}>EVERYTHING FOR YOUR FLEET</Text>
              <View style={styles.featureGrid}>
                <Feature icon="location-outline" text="Live map" color={STATE_META.moving.color} soft={STATE_META.moving.soft} />
                <Feature icon="git-commit-outline" text="Trips" color={colors.primary} soft={colors.primarySoft} />
                <Feature icon="notifications-outline" text="Alerts" color={STATE_META.stopped.color} soft={STATE_META.stopped.soft} />
                <Feature icon="cube-outline" text="Loads" color={STATE_META.idle.color} soft={STATE_META.idle.soft} />
                <Feature icon="bus-outline" text="Trailers" color={STATE_META.parked.color} soft={STATE_META.parked.soft} />
                <Feature icon="shapes-outline" text="Zones" color={STATE_META.offline.color} soft={STATE_META.offline.soft} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {typing ? null : (
        <Text style={[styles.version, { bottom: bottom + space.md }]}>
          Version {Constants.expoConfig?.version ?? ""} · app.riogps.com
        </Text>
      )}
    </View>
  );
}

function Feature({
  icon,
  text,
  color,
  soft,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  color: string;
  soft: string;
}) {
  return (
    <View style={styles.feature}>
      <View style={[styles.featureIcon, { backgroundColor: softTint(color, soft) }]}>
        <Ionicons name={icon} size={16} color={ink(color)} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  hero: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    width: "100%",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  waves: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: 150,
  },
  wavesDark: { opacity: 0.08 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl - 4 },
  brand: { alignItems: "center", gap: space.sm },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    ...elevation.md,
  },
  logo: { width: 104, height: 48 },
  title: {
    marginTop: space.xs,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  tagline: {
    maxWidth: 290,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
  },
  card: {
    gap: space.md,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 20,
    borderRadius: 20,
    backgroundColor: colors.background,
    ...elevation.lg,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: colors.foreground,
  },
  forgot: {
    alignSelf: "flex-end",
    minHeight: 24,
    justifyContent: "center",
    marginTop: -space.xs,
  },
  forgotText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: colors.primary,
  },
  code: { letterSpacing: 4, fontSize: 20 },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: -space.sm,
  },
  features: { marginTop: space.lg, gap: space.sm },
  featureHead: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.6, textAlign: "center", color: colors.mutedForeground },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  feature: {
    flexGrow: 1,
    flexBasis: "31%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 42,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    ...elevation.sm,
  },
  featureIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  version: {
    ...type.caption,
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: isDark ? colors.mutedForeground : "#3d4a63",
  },
});
