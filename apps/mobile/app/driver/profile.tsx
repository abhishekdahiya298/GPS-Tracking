import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ErrorNote, Field } from "@/components/ui";
import { driver } from "@/driver/api";
import { useDriverData } from "@/driver/DriverData";
import { useDriverSession } from "@/driver/DriverSession";
import { driverStyles as ds } from "@/driver/parts";
import { colors, space, themed } from "@/theme";

/** R8: the driver edits their own profile. Every company they work with sees the change. */
export default function EditProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useDriverSession();
  const data = useDriverData();
  const me = session.state.status === "signedIn" ? session.state.me : null;
  const [form, setForm] = useState({ name: me?.driver.name ?? "", email: me?.driver.email ?? "", licenseNumber: me?.driver.licenseNumber ?? "", licenseExpiresOn: me?.driver.licenseExpiresOn ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const companies = data.companies.filter((c) => c.link === "active").length || 1;

  async function save() {
    setError(null);
    if (!form.name.trim()) return setError("Enter your name.");
    if (form.licenseExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(form.licenseExpiresOn.trim())) return setError("Write the licence expiry like 2027-05-31.");
    setBusy(true);
    try {
      await driver.updateProfile({ name: form.name.trim(), email: form.email.trim(), licenseNumber: form.licenseNumber.trim(), licenseExpiresOn: form.licenseExpiresOn.trim() });
      await session.refresh();
      Alert.alert("Saved", companies > 1 ? `Your ${companies} companies see the new details.` : "Your company sees the new details.");
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={ds.screen} contentContainerStyle={[ds.body, { paddingTop: space.lg, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.card}>
        <Field label="Your name" icon="person-outline" value={form.name} onChangeText={(v) => set("name", v)} autoComplete="name" textContentType="name" />
        <Field label="Email (for sign-in codes)" icon="mail-outline" value={form.email} onChangeText={(v) => set("email", v)} autoComplete="email" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
        <Field label="Driver's licence number" icon="card-outline" value={form.licenseNumber} onChangeText={(v) => set("licenseNumber", v)} autoCapitalize="characters" />
        <Field label="Licence expires (YYYY-MM-DD)" icon="calendar-outline" value={form.licenseExpiresOn} onChangeText={(v) => set("licenseExpiresOn", v)} keyboardType="numbers-and-punctuation" placeholder="2027-05-31" />
        <View style={styles.readonly}>
          <Text style={styles.roLabel}>Mobile number</Text>
          <Text style={styles.roValue}>{me.driver.phone ?? "Not set"}</Text>
          <Text style={styles.roHint}>Your number is how companies find you. To change it, ask your company.</Text>
        </View>
      </View>
      {error ? <ErrorNote text={error} /> : null}
      <Button title="Save" onPress={() => void save()} loading={busy} />
      <Text style={styles.fine}>{companies > 1 ? `Saved for all ${companies} companies you work for.` : `Saved for ${me.company.name}.`}</Text>
    </ScrollView>
  );
}

const styles = themed(() => ({
  card: { gap: space.md, padding: 14, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  readonly: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  roLabel: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  roValue: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  roHint: { fontSize: 12.5, color: colors.mutedForeground },
  fine: { fontSize: 12.5, textAlign: "center", color: colors.mutedForeground }
}));
