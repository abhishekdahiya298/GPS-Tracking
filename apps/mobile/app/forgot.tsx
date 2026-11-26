import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { signInMessage } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { ArrowButton, AuthShell, DRIVER_TONE, Note, OutlineButton, RoleSwitch } from "@/components/AuthShell";
import { PopIn } from "@/components/motion";
import { ErrorNote, Field } from "@/components/ui";
import { colors, themed } from "@/theme";

/**
 * M2 Forgot password: the server emails a link that opens the website's reset page. The answer is
 * the same whether or not the address has an account, so nobody can probe for accounts here.
 */
export default function ForgotScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <AuthShell back title="Forgot your" accent="password?" tagline="We'll email you a link to set a new one." cardKey={sent ? "sent" : "form"}>
      <RoleSwitch active="fleet" onChange={() => router.replace("/driver")} />
      {sent ? (
        <>
          <PopIn>
            <Note icon="mail-open-outline" bold="Check your inbox." text={`If ${email.trim()} has an account, a reset link is on its way. It works for 30 minutes.`} />
          </PopIn>
          <OutlineButton title="Back to sign in" icon="log-in-outline" onPress={() => router.replace("/login")} />
        </>
      ) : (
        <>
          <Text style={styles.h1}>Reset your password</Text>
          <Field label="Email you sign in with" icon="mail-outline" placeholder="you@company.com" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" returnKeyType="send" onSubmitEditing={send} />
          {error && <ErrorNote text={error} />}
          <ArrowButton title="Send reset link" onPress={send} loading={busy} />
          <Note icon="time-outline" text="The link works for 30 minutes. Check your spam folder too." />
          <Note icon="car-outline" tone={DRIVER_TONE} bold="Driver?" text="Drivers don't have a password. Switch to Driver and use your mobile number." />
        </>
      )}
    </AuthShell>
  );
}

const styles = themed(() => ({
  h1: { fontSize: 18, fontWeight: "800", textAlign: "center", color: colors.foreground }
}));
