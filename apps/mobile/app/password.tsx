import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";
import { ApiError, api } from "@/api";
import { Card } from "@/components/kit";
import { Button, ErrorNote, Field } from "@/components/ui";
import { haptic } from "@/haptics";
import { colors, font, space } from "@/theme";

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

  async function submit() {
    if (!current || !next) return setError("Enter your current password and a new one.");
    if (next.length < MIN_LENGTH) return setError(`The new password needs at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      // This phone stays signed in; other devices keep their sessions too.
      await api.send("change-password", { method: "POST", area: "auth", body: { currentPassword: current, newPassword: next, revokeOtherSessions: false } });
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
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          {done ? (
            <>
              <Text style={styles.title}>Password changed</Text>
              <Text style={styles.note}>Use the new password the next time you sign in, here and on the website.</Text>
              <Button title="Done" onPress={() => router.back()} />
            </>
          ) : (
            <>
              <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
              <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
              <Field label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} returnKeyType="done" />
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
  content: { padding: space.lg },
  card: { gap: space.lg },
  title: { fontSize: font.title, fontWeight: "800", color: colors.foreground },
  note: { fontSize: font.body, color: colors.mutedForeground, lineHeight: 21 }
});
