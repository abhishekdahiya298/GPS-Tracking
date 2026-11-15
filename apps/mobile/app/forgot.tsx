import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInMessage } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { FadeInUp } from "@/components/motion";
import { Button, ErrorNote, Field } from "@/components/ui";
import { useBottomInset, useScreen } from "@/layout";
import { colors, elevation, isDark, radius, space, themed, type } from "@/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- React Native loads images with require() */
const HERO = require("../assets/hero-reset.png");
const WAVES = require("../assets/waves.png");
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Forgot password: the server emails a link that opens the website's reset page. The answer is
 * the same whether or not the address has an account, so nobody can probe for accounts here.
 */
export default function ForgotScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useBottomInset();
  const { width } = useScreen();
  const { requestPasswordReset } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heroHeight = Math.round(300 * (width / 390));

  async function send() {
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email you sign in with.");
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (e) {
      setError(signInMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Image source={HERO} style={[styles.hero, { height: heroHeight }]} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
      <Image source={WAVES} style={[styles.waves, isDark && styles.wavesDark]} resizeMode="stretch" accessibilityElementsHidden importantForAccessibility="no" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.sm, paddingBottom: space.lg + bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to sign in">
            <Ionicons name="arrow-back" size={20} color="#ffffff" />
          </Pressable>
          <FadeInUp style={styles.brand} distance={16}>
            <View style={styles.lock}>
              <Ionicons name="lock-closed-outline" size={26} color="#ffffff" />
            </View>
            <Text style={styles.title} accessibilityRole="header">{sent ? "Check your email" : "Reset your password"}</Text>
            <Text style={styles.tagline}>{sent ? `If ${email.trim()} has an account, a reset link is on its way.` : "We will email you a link to set a new one."}</Text>
          </FadeInUp>

          <FadeInUp index={1} distance={16} style={styles.card}>
            {sent ? (
              <Button title="Back to sign in" onPress={() => router.back()} icon="arrow-back" />
            ) : (
              <>
                <Text style={styles.cardTitle}>Email you sign in with</Text>
                <Field label="Email you sign in with" hideLabel icon="mail-outline" placeholder="you@company.com" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" returnKeyType="send" onSubmitEditing={send} autoFocus />
                {error && <ErrorNote text={error} />}
                <Button title="Send reset link" onPress={send} loading={busy} icon="paper-plane-outline" />
              </>
            )}
            <View style={styles.note}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <Text style={styles.noteTitle}>The link works for 30 minutes.</Text>
                <Text style={type.small}>Check your inbox and spam folder if it does not arrive.</Text>
              </View>
            </View>
          </FadeInUp>

          <FadeInUp index={2} distance={16} style={styles.help}>
            <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.helpText}>No email? Your fleet admin can reset it for you on the website.</Text>
          </FadeInUp>

          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backLink} accessibilityRole="button">
            <Ionicons name="arrow-back" size={18} color={colors.primary} />
            <Text style={styles.backText}>Back to sign in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  hero: { position: "absolute", left: 0, right: 0, top: 0, width: "100%", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  waves: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 130 },
  wavesDark: { opacity: 0.08 },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl - 4, gap: space.lg },
  back: { width: 40, height: 40, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", gap: space.sm },
  lock: { width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  title: { marginTop: space.xs, fontSize: 26, lineHeight: 32, fontWeight: "700", color: "#ffffff", textAlign: "center" },
  tagline: { maxWidth: 300, fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.82)", textAlign: "center" },
  card: { marginTop: space.lg, gap: space.md, padding: 18, borderRadius: 20, backgroundColor: colors.background, ...elevation.lg },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  note: { flexDirection: "row", gap: 10, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  noteTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700", color: colors.foreground },
  help: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 14, borderRadius: 16, backgroundColor: colors.background, ...elevation.sm },
  helpText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground },
  backLink: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  backText: { fontSize: 15, fontWeight: "700", color: colors.primary }
}));
