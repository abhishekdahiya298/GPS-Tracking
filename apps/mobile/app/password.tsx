import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";
import { ApiError, api, tokenStore } from "@/api";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/kit";
import { PopIn } from "@/components/motion";
import { Button, ErrorNote, Field } from "@/components/ui";
import { haptic } from "@/haptics";
import { useBottomInset } from "@/layout";
import { colors, space, type } from "@/theme";

/** Same rule as the server (web lib/auth.ts minPasswordLength). */
const MIN_LENGTH = 6;

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [kept, setKept] = useState(true);
  const bottom = useBottomInset();

  async function submit() {
    if (!current || !next) return setError("Enter your current password and a new one.");
    if (next.length < MIN_LENGTH) return setError(`The new password needs at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      // As on the website: every other device is signed out. The server answers with a new
      // session for this phone; without it this phone is signed out too at its next request.
      const { headers } = await api.send("change-password", { method: "POST", area: "auth", body: { currentPassword: current, newPassword: next, revokeOtherSessions: true } });
      const fresh = headers.get("set-auth-token");
      if (fresh) await tokenStore.set(fresh);
      setKept(!!fresh);
      haptic.success();
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      haptic.warn();
      if (e instanceof ApiError && e.kind === "rate_limited") setError("Too many attempts. Try again in a minute.");
      else if (e instanceof ApiError && e.code === "INVALID_PASSWORD") setError("The current password is not right.");
      else if (e instanceof ApiError && (e.kind === "network" || e.kind === "timeout")) setError(e.message);
      else setError(e instanceof ApiError && e.status === 400 ? e.message : "Could not change the password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: space.lg + bottom }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card style={styles.card}>
          {done ? (
            <>
              <PopIn style={styles.done}>
                <Ionicons name="checkmark" size={28} color={colors.success} />
              </PopIn>
              <Text style={styles.title}>Password changed</Text>
              <Text style={styles.note}>
                {kept ? "Your other devices have been signed out. Use the new password the next time you sign in, here and on the website." : "All devices have been signed out, including this phone. Sign in again with the new password."}
              </Text>
              <Button title="Done" onPress={() => router.back()} />
            </>
          ) : (
            <>
              <Field icon="lock-closed-outline" label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
              <Field icon="key-outline" label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
              <Field icon="key-outline" label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} returnKeyType="done" />
              {error ? <ErrorNote text={error} /> : null}
              <Button title="Change password" onPress={submit} loading={busy} />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm },
  card: { gap: space.lg },
  done: { alignSelf: "center", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.successSoft, alignItems: "center", justifyContent: "center" },
  title: { ...type.title, textAlign: "center" },
  note: { ...type.body, color: colors.mutedForeground, textAlign: "center" }
});
