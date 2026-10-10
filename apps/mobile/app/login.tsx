import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { codeFailure, signInMessage, type CodeKind } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { Button, ErrorNote, Field } from "@/components/ui";
import { colors, font, radius, space } from "@/theme";

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
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.brandName}>RIO GPS</Text>
            <Text style={styles.brandNote}>Fleet tracking</Text>
          </View>

          <View style={styles.card}>
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primaryDark },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  brand: { alignItems: "center", marginBottom: space.xl },
  brandName: { color: colors.primaryForeground, fontSize: 30, fontWeight: "700", letterSpacing: 1 },
  brandNote: { color: "#c7d3f2", fontSize: font.body, marginTop: space.xs },
  card: { backgroundColor: colors.background, borderRadius: radius.xl, padding: space.xl, gap: space.lg },
  title: { fontSize: font.heading, fontWeight: "700", color: colors.foreground },
  help: { fontSize: font.body, color: colors.mutedForeground, lineHeight: 21, marginTop: -space.sm },
  code: { letterSpacing: 4, fontSize: 20 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: -space.sm },
  footnote: { fontSize: font.small, color: colors.mutedForeground, textAlign: "center", lineHeight: 19 }
});
