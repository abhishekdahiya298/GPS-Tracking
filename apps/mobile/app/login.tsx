import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { codeFailure, signInMessage, type CodeKind } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { AuthShell, AuthTabs, LinkCard } from "@/components/AuthShell";
import { Button, ErrorNote, Field } from "@/components/ui";
import { colors, space, themed } from "@/theme";

/** M1: sign in for owners and dispatchers, with the website's Sign in | Create account tabs. */
export default function LoginScreen() {
  const router = useRouter();
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
    if (!email.trim() || !password) return setError("Enter your email and password.");
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
    if (!code.trim()) return setError(kind === "backup" ? "Enter a backup code." : "Enter the 6-digit code.");
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

  if (pending) {
    return (
      <AuthShell
        title="Two-step verification"
        tagline={kind === "backup" ? "Enter one of the backup codes you saved when you turned on two-step verification." : "Enter the 6-digit code from your authenticator app."}
        cardKey="code"
      >
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
        <Button title="Verify" onPress={onVerify} loading={busy} icon="shield-checkmark-outline" />
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
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      tagline="Sign in to see your fleet."
      cardKey="password"
      below={<LinkCard icon="car-outline" color="#a3470a" soft="#fcd9b2" title="Driver?" detail="Sign in with your phone or invite link" onPress={() => router.push("/driver")} />}
    >
      <AuthTabs active="signin" />
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
      <Pressable onPress={() => router.push("/forgot")} hitSlop={8} style={styles.forgot} accessibilityRole="link">
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>
      {error && <ErrorNote text={error} />}
      <Button title="Sign in" onPress={onSignIn} loading={busy} icon="arrow-forward" />
    </AuthShell>
  );
}

const styles = themed(() => ({
  forgot: { alignSelf: "flex-end", minHeight: 24, justifyContent: "center", marginTop: -space.xs },
  forgotText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.primary },
  code: { letterSpacing: 4, fontSize: 20 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: -space.sm }
}));
