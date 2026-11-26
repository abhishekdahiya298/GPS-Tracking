import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ApiError } from "@/api";
import { signInMessage } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { pendingSignIn, signup } from "@/auth/signup";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorNote, Field } from "@/components/ui";
import { colors, space, themed } from "@/theme";

/** S3: one code, sent to the email and the phone. Type it once. */
export default function SignupCode() {
  const router = useRouter();
  const { signIn } = useSession();
  const p = useLocalSearchParams<{ token: string; email?: string; phone?: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(30);
  const [sentTo, setSentTo] = useState({ email: p.email || null, phone: p.phone || null });

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify() {
    if (busy) return;
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError(null);
    try {
      await signup.verify(p.token, code.trim(), pendingSignIn.password);
      await signIn(pendingSignIn.email, pendingSignIn.password);
      pendingSignIn.password = "";
    } catch (e) {
      setError(e instanceof ApiError && e.kind === "bad_response" ? e.message : e instanceof ApiError && (e.kind === "forbidden" || e.kind === "not_found") ? e.message : signInMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const r = await signup.resend(p.token);
      setSentTo(r.sentTo);
      setWait(30);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send a new code.");
    }
  }

  return (
    <AuthShell back title="Check your" accent="inbox" tagline="One code, sent to your email and your phone.">
      <View style={styles.sent}>
        {sentTo.email ? <Sent icon="mail-outline" text={sentTo.email} /> : null}
        {sentTo.phone ? <Sent icon="chatbubble-outline" text={sentTo.phone} /> : null}
      </View>
      <Field label="Enter the code" icon="keypad-outline" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoFocus maxLength={6} returnKeyType="done" onSubmitEditing={verify} style={styles.code} />
      <View style={styles.row}>
        <Text style={styles.muted}>{wait > 0 ? `Didn't get it? Resend in 0:${String(wait).padStart(2, "0")}` : "Didn't get it?"}</Text>
        {wait > 0 ? null : (
          <Text style={styles.link} onPress={resend} accessibilityRole="button">
            Send a new code
          </Text>
        )}
      </View>
      {error && <ErrorNote text={error} />}
      <Button title="Verify and start" icon="arrow-forward" onPress={verify} loading={busy} />
      <Text style={styles.change} onPress={() => router.back()} accessibilityRole="button">
        Change email or phone
      </Text>
    </AuthShell>
  );
}

function Sent({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={14} color={colors.success} />
      <Text style={styles.chipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = themed(() => ({
  sent: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 99, backgroundColor: colors.successSoft, maxWidth: "100%" },
  chipText: { fontSize: 12.5, fontWeight: "600", color: colors.success, flexShrink: 1 },
  code: { letterSpacing: 8, fontSize: 22, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: -space.xs },
  muted: { fontSize: 13, color: colors.mutedForeground },
  link: { fontSize: 13, fontWeight: "600", color: colors.primary },
  change: { fontSize: 14, fontWeight: "600", color: colors.primary, textAlign: "center" }
}));
