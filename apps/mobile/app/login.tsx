import { useEffect, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { codeFailure, signInMessage, type CodeKind } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { FadeInUp } from "@/components/motion";
import { Button, ErrorNote, Field } from "@/components/ui";
import { useBottomInset, useScreen } from "@/layout";
import { colors, space, type, themed } from "@/theme";

const ROUTE = require("../assets/signin-route.png"); // eslint-disable-line @typescript-eslint/no-require-imports -- React Native loads images with require()
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
  const { compact, scale, height } = useScreen();
  // The picture along the bottom shows only when there is room for it: a tall phone, keyboard closed.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const roomy = height >= 780 && !typing;
  const bottom = useBottomInset();
  // A short phone gets a smaller logo and tighter spacing so the whole form fits above the keyboard.
  const logoWidth = compact ? scale(140) : scale(172);

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
    <SafeAreaView style={styles.screen}>
      {/* A quiet picture along the bottom edge. Hidden on a short phone, where the form needs the room. */}
      {!roomy ? null : <Image source={ROUTE} style={styles.route} resizeMode="stretch" accessibilityElementsHidden importantForAccessibility="no" />}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.lg + bottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <FadeInUp style={[styles.brand, compact && { marginBottom: space.lg }]} distance={16}>
            <Image source={LOGO} style={{ width: logoWidth, height: Math.round(logoWidth * (352 / 720)) }} resizeMode="contain" accessibilityLabel="RIO GPS" />
            <View style={styles.heading}>
              <Text style={type.largeTitle} accessibilityRole="header">{pending ? "Two-step verification" : "Sign in"}</Text>
              <Text style={styles.help}>
                {pending
                  ? kind === "backup"
                    ? "Enter one of the backup codes you saved when you turned on two-step verification."
                    : "Enter the 6-digit code from your authenticator app."
                  : "Track your fleet live, from anywhere."}
              </Text>
            </View>
          </FadeInUp>

          <FadeInUp key={pending ? "code" : "password"} index={1} distance={16} style={styles.form}>
            {pending ? (
              <>
                <Field
                  key={kind}
                  label={kind === "backup" ? "Backup code" : "Verification code"}
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
                <Field
                  label="Email"
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
                {error && <ErrorNote text={error} />}
                <View style={styles.submit}>
                  <Button title="Sign in" onPress={onSignIn} loading={busy} />
                </View>
                <Text style={styles.footnote}>Accounts are created by your administrator. To reset a password, use the website.</Text>
              </>
            )}
          </FadeInUp>
        </ScrollView>
      </KeyboardAvoidingView>
      {!roomy ? null : <Text style={[styles.version, { bottom: bottom + space.lg }]}>Version {Constants.expoConfig?.version ?? ""}</Text>}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingTop: space.lg },
  brand: { alignItems: "center", gap: space.lg, marginBottom: space.xxl },
  heading: { alignItems: "center", gap: space.xs },
  help: { ...type.body, color: colors.mutedForeground, textAlign: "center" },
  form: { gap: space.lg },
  submit: { marginTop: space.sm },
  code: { letterSpacing: 4, fontSize: 20 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: -space.sm },
  footnote: { ...type.small, textAlign: "center" },
  route: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 150 },
  version: { ...type.caption, position: "absolute", left: 0, right: 0, textAlign: "center" }
}));
