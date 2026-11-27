import { PhoneField, phoneProblem } from "@/components/PhoneField";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { signInMessage } from "@/auth/service";
import { useSession } from "@/auth/SessionProvider";
import { FLEET_SIZES, guessCountry, pendingSignIn, phoneZone, signup, type CompanyDetails, type Role } from "@/auth/signup";
import { ApiError } from "@/api";
import { ArrowButton, AuthShell, StepDots } from "@/components/AuthShell";
import { ErrorNote, Field } from "@/components/ui";
import { colors, radius, space, themed } from "@/theme";

const ROLE_LABEL: Record<Role, string> = { fleet: "I run trucks", operator: "Owner-operator", broker: "I book loads" };

/** S2: company and you, on one screen. One code then goes to the email and the phone. */
export default function SignupDetails() {
  const router = useRouter();
  const { signIn } = useSession();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === "operator" || params.role === "broker" ? params.role : "fleet";
  const zone = useMemo(phoneZone, []);
  const [form, setForm] = useState<CompanyDetails>({ role, company: "", name: "", phone: "", email: "", password: "", fleetSize: role === "operator" ? "1" : "2-5", country: guessCountry(zone), timeZone: zone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CompanyDetails>(k: K, v: CompanyDetails[K]) => setForm((f) => ({ ...f, [k]: v }));
  const refs = { name: useRef<TextInput>(null), phone: useRef<TextInput>(null), email: useRef<TextInput>(null), password: useRef<TextInput>(null) };

  async function submit() {
    if (busy) return;
    if (form.company.trim().length < 2 || form.name.trim().length < 2) return setError("Enter your company name and your name.");
    if (!form.phone.trim() || !form.email.trim()) return setError("Enter your mobile number and work email.");
    const badPhone = phoneProblem(form.phone);
    if (badPhone) return setError(badPhone);
    if (form.password.length < 10) return setError("Use at least 10 characters for the password.");
    setError(null);
    setBusy(true);
    try {
      const r = await signup.start({ ...form, company: form.company.trim(), name: form.name.trim(), email: form.email.trim() });
      if (r.status === "created") {
        await signIn(form.email, form.password);
        return;
      }
      pendingSignIn.email = form.email.trim();
      pendingSignIn.password = form.password;
      router.push({ pathname: "/signup/code", params: { token: r.token, email: r.sentTo.email ?? "", phone: r.sentTo.phone ?? "" } });
    } catch (e) {
      setError(e instanceof ApiError && e.kind !== "network" && e.kind !== "timeout" && e.kind !== "server" ? e.message : signInMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const city = form.timeZone.split("/").pop()?.replace(/_/g, " ");
  return (
    <AuthShell back title="Your" accent="company" tagline={`${ROLE_LABEL[role]} · You'll be the admin.`}>
        <StepDots step={2} />
        <View style={styles.cardInner}>
          <Field label="Company name" icon="business-outline" value={form.company} onChangeText={(v) => set("company", v)} autoComplete="organization" textContentType="organizationName" returnKeyType="next" onSubmitEditing={() => refs.name.current?.focus()} />
          <View style={styles.two}>
            <View style={styles.half}>
              <Field ref={refs.name} label="Your name" value={form.name} onChangeText={(v) => set("name", v)} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => refs.phone.current?.focus()} />
            </View>
            <View style={styles.half}>
              <PhoneField ref={refs.phone} value={form.phone} defaultCountry={form.country} onChangeText={(v) => set("phone", v)} returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()} />
            </View>
          </View>
          <Field ref={refs.email} label="Work email" icon="mail-outline" value={form.email} onChangeText={(v) => set("email", v)} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => refs.password.current?.focus()} />
          <Field ref={refs.password} label="Password" icon="lock-closed-outline" value={form.password} onChangeText={(v) => set("password", v)} placeholder="At least 10 characters" secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" />
          {role !== "broker" && (
            <View style={styles.sizes}>
              <Text style={styles.label}>How many trucks?</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {FLEET_SIZES.map((s) => {
                  const on = form.fleetSize === s;
                  return (
                    <Pressable key={s} onPress={() => set("fleetSize", s)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && { color: "#ffffff" }]}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <Pressable onPress={() => set("country", form.country === "CA" ? "US" : "CA")} accessibilityRole="button" accessibilityLabel={`Country ${form.country === "CA" ? "Canada" : "United States"}. Change`} style={styles.region}>
            <Ionicons name="globe-outline" size={16} color={colors.primary} />
            <Text style={styles.regionText}>
              {form.country === "CA" ? "Canada" : "United States"}
              {city ? ` · ${city} time` : ""}
            </Text>
            <Text style={styles.link}>Change</Text>
          </Pressable>
        </View>
        {error && <ErrorNote text={error} />}
        <ArrowButton title="Send my code" onPress={submit} loading={busy} />
        <Text style={styles.fine}>One code goes to your email and phone. By continuing you agree to the Terms and Privacy policy.</Text>
    </AuthShell>
  );
}

const styles = themed(() => ({
  cardInner: { gap: space.md },
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, height: 52 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: colors.foreground },
  body: { paddingHorizontal: space.lg, gap: space.md },
  progress: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bar: { flex: 1, height: 5, borderRadius: 9, backgroundColor: colors.border },
  barOn: { backgroundColor: colors.primary },
  step: { fontSize: 12, fontWeight: "700", color: colors.mutedForeground },
  lead: { fontSize: 13, color: colors.mutedForeground },
  link: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  card: { gap: space.md, padding: 14, borderRadius: 18, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  two: { flexDirection: "row", gap: space.sm },
  half: { flex: 1, minWidth: 0 },
  sizes: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  chips: { flexDirection: "row", gap: 6 },
  chip: { flex: 1, height: 38, borderRadius: 99, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.foreground },
  region: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.muted },
  regionText: { flex: 1, fontSize: 13, color: colors.foreground },
  fine: { fontSize: 12, textAlign: "center", color: colors.mutedForeground }
}));
