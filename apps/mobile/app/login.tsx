import { useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { codeFailure, signInMessage, type CodeKind } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { FadeInUp } from "@/components/motion";
import { Button, ErrorNote, Field } from "@/components/ui";
import { useBottomInset, useScreen } from "@/layout";
import { colors, elevation, font, gradient, space } from "@/theme";

const LOGO = require("../assets/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports -- React Native loads images with require()

export default function LoginScreen() {
  const { signIn, verifyCode } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Set only while the second step is open. Kept in memory, never stored.
  const [pending, setPending] = useState<string | null>(null);
  const [kind, setKind] = useState<CodeKind>("app");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const { compact, scale } = useScreen();
  const bottom = useBottomInset();
  // A short phone gets a smaller logo and tighter spacing so the whole form fits above the keyboard.
  const logoWidth = compact ? scale(190) : scale(240);

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
      setError(kind === "backup" ? "Enter a backup code." : "Enter the 6-digit code.");
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
    <LinearGradient colors={gradient.brand} start={gradient.angle.start} end={gradient.angle.end} style={styles.flex}>
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.lg + bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <FadeInUp style={[styles.brand, compact && { marginBottom: space.lg }]} distance={20}>
            <View style={styles.logoCard}>
              <Image source={LOGO} style={{ width: logoWidth, height: Math.round(logoWidth * (93 / 190)) }} resizeMode="contain" accessibilityLabel="RIO GPS" />
            </View>
            <Text style={styles.brandNote}>Live fleet tracking for trucks and trailers</Text>
          </FadeInUp>

          <FadeInUp index={2} distance={24} style={styles.card}>
            {pending ? (
              <>
                <Text style={styles.title}>Two-step verification</Text>
                <Text style={styles.help}>
                  {kind === "backup" ? "Enter one of the backup codes you saved when you turned on two-step verification." : "Enter the 6-digit code from your authenticator app."}
                </Text>
                <Field
                  key={kind}
                  label={kind === "backup" ? "Backup code" : "Verification code"}
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
                <Button title="Verify" onPress={onVerify} loading={busy} />
                <View style={styles.links}>
                  <Button
                    variant="ghost"
                    title={kind === "backup" ? "Use the authenticator app" : "Use a backup code"}
                    onPress={() => {
                      setError(null);
                      setCode("");
                      setKind(kind === "backup" ? "app" : "backup");
                    }}
                    disabled={busy}
                  />
                  <Button variant="ghost" title="Start again" onPress={() => startAgain()} disabled={busy} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>Sign in</Text>
                <Field
                  label="Email"
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
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={onSignIn}
                />
                {error && <ErrorNote text={error} />}
                <Button title="Sign in" onPress={onSignIn} loading={busy} />
                <Text style={styles.footnote}>Accounts are created by your administrator. To reset a password, use the website.</Text>
              </>
            )}
          </FadeInUp>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  brand: { alignItems: "center", marginBottom: space.xl },
  logoCard: { backgroundColor: "#ffffff", borderRadius: 22, paddingHorizontal: 22, paddingVertical: 14, ...elevation.lg },
  brandNote: { color: "#d5defa", fontSize: font.body, marginTop: space.md, textAlign: "center" },
  card: { backgroundColor: colors.background, borderRadius: 22, padding: space.xl, gap: space.md, ...elevation.lg },
  title: { fontSize: font.heading, fontWeight: "700", color: colors.foreground },
  help: { fontSize: font.body, color: colors.mutedForeground, lineHeight: 21, marginTop: -space.sm },
  code: { letterSpacing: 4, fontSize: 20 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: -space.sm },
  footnote: { fontSize: font.small, color: colors.mutedForeground, textAlign: "center", lineHeight: 19 }
});
