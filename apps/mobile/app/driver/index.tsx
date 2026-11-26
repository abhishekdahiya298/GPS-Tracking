import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ApiError } from "@/api";
import { ArrowButton, AuthShell, CodeBoxes, DRIVER_TONE, Note, RoleSwitch, StepDots } from "@/components/AuthShell";
import { PopIn } from "@/components/motion";
import { ErrorNote, Field } from "@/components/ui";
import { driver, type InvitePeek, type PhoneStart } from "@/driver/api";
import { useDriverSession } from "@/driver/DriverSession";
import { inviteToken } from "@/driver/model";
import { colors, space, themed } from "@/theme";

type Mode =
  | { m: "phone" }
  | { m: "code"; phone: string; start: PhoneStart }
  | { m: "name"; phone: string; code: string }
  | { m: "invite"; token: string }
  | { m: "paste" };

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const T = DRIVER_TONE;

/**
 * Drivers: sign in or sign up with a mobile number (D1 → D1B code → D1F name, for new numbers).
 * No company needed. Also opened by a company's one-tap link (riogps://driver?t=…).
 */
export default function DriverSignIn() {
  const params = useLocalSearchParams<{ t?: string }>();
  const router = useRouter();
  const session = useDriverSession();
  const [mode, setMode] = useState<Mode>(() => (params.t ? { m: "invite", token: params.t } : { m: "phone" }));
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(true);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<InvitePeek | null>(null);

  useEffect(() => {
    if (params.t) setMode({ m: "invite", token: params.t });
  }, [params.t]);
  useEffect(() => {
    if (mode.m !== "invite") return;
    setPeek(null);
    driver
      .peekInvite(mode.token)
      .then(setPeek)
      .catch(() => setPeek({ state: "unknown" }));
  }, [mode]);

  // Test numbers: the code comes back from the server and is typed in for the driver, one digit at a time.
  const filling = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (mode.m !== "code" || !mode.start.testCode) return;
    const full = mode.start.testCode;
    let i = 0;
    setCode("");
    filling.current = setInterval(() => {
      i += 1;
      setCode(full.slice(0, i));
      if (i >= full.length && filling.current) clearInterval(filling.current);
    }, 140);
    return () => {
      if (filling.current) clearInterval(filling.current);
    };
  }, [mode]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toFleet = () => router.replace("/login");

  if (mode.m === "invite") {
    const ok = peek?.state === "ok";
    return (
      <AuthShell back photo="driver" title="Join" accent={peek?.companyName ?? "your company"} tagline="Opened from your company's RIO GPS link. No password needed." cardKey="invite">
        {!peek ? (
          <ActivityIndicator color={T.main} />
        ) : ok ? (
          <>
            <View style={styles.who}>
              <Ionicons name="person-circle" size={34} color={T.main} />
              <View style={styles.flexShrink}>
                <Text style={styles.whoName}>{peek.driverName}</Text>
                <Text style={styles.whoCompany}>Driver at {peek.companyName}</Text>
              </View>
            </View>
            {error && <ErrorNote text={error} />}
            <ArrowButton tone={T} title={`Continue as ${(peek.driverName ?? "").split(" ")[0]}`} loading={busy} onPress={() => run(async () => session.signInWithInvite(mode.token).catch((e) => setError(say(e, "Couldn't sign in. Try again."))))} />
            <Note tone={T} text={`${peek.companyName} sees your location while you're signed in. You can leave any time in Account.`} />
          </>
        ) : (
          <>
            <ErrorNote text={peek.state === "used" ? "This link was already used." : peek.state === "expired" ? "This link has expired." : "This link isn't valid."} />
            <ArrowButton tone={T} title="Use my mobile number" onPress={() => setMode({ m: "phone" })} />
          </>
        )}
      </AuthShell>
    );
  }

  if (mode.m === "paste") {
    return (
      <AuthShell back photo="driver" title="Your company's" accent="link" tagline="Paste the RIO GPS link your company sent you." cardKey="paste">
        <Field label="Link" icon="link-outline" value={link} onChangeText={setLink} placeholder="https://app.riogps.com/driver-app?t=…" autoCapitalize="none" autoCorrect={false} />
        {error && <ErrorNote text={error} />}
        <ArrowButton
          tone={T}
          title="Continue"
          onPress={() => {
            const t = inviteToken(link);
            if (!t) return setError("That doesn't look like a RIO GPS link. Copy the whole link from the message.");
            setError(null);
            setMode({ m: "invite", token: t });
          }}
        />
        <Text style={styles.link} onPress={() => setMode({ m: "phone" })}>
          Use my mobile number instead
        </Text>
      </AuthShell>
    );
  }

  if (mode.m === "code") {
    const { start } = mode;
    const where = start.channel === "test" ? "Test number: your code is filled in for you." : start.channel === "email" ? `We emailed a 6-digit code to ${start.sentTo ?? "your email"}.` : `We sent a 6-digit code to ${start.sentTo ?? mode.phone}.`;
    const next = () =>
      run(async () => {
        if (code.length !== 6) return setError("Enter the 6-digit code.");
        if (start.newDriver) return setMode({ m: "name", phone: mode.phone, code });
        await session.verifyPhone(mode.phone, code).catch((e) => setError(say(e, "That code didn't work.")));
      });
    return (
      <AuthShell back photo="driver" title="Check your" accent={start.channel === "email" ? "email" : "texts"} tagline={where} cardKey="code">
        <StepDots step={2} tone={T} />
        <Text style={styles.h1}>Enter the code</Text>
        <CodeBoxes value={code} onChange={setCode} tone={T} autoFocus={!start.testCode} />
        <View style={styles.row}>
          <Text style={styles.muted}>Codes expire after 10 minutes</Text>
          <Pressable onPress={() => setMode({ m: "phone" })} hitSlop={8}>
            <Text style={styles.linkSmall}>Change number</Text>
          </Pressable>
        </View>
        {error && <ErrorNote text={error} />}
        <ArrowButton tone={T} title={start.newDriver ? "Continue" : "Verify"} onPress={next} loading={busy} />
        <Note tone={T} text="Nothing is shared until you accept a request." />
      </AuthShell>
    );
  }

  if (mode.m === "name") {
    return (
      <AuthShell back photo="driver" title="Welcome to" accent="RIO GPS" tagline="One last thing: your name." cardKey="name">
        <StepDots step={3} tone={T} />
        <PopIn>
          <View style={styles.confirmed}>
            <Ionicons name="checkmark-circle" size={20} color="#0f5c2c" />
            <Text style={styles.confirmedText}>
              <Text style={{ fontWeight: "800" }}>{mode.phone}</Text> confirmed
            </Text>
          </View>
        </PopIn>
        <Field label="Your name" icon="person-outline" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoFocus placeholder="First and last name" />
        <Pressable onPress={() => setAgree((a) => !a)} style={styles.agree} accessibilityRole="checkbox" accessibilityState={{ checked: agree }}>
          <View style={[styles.box, agree && { backgroundColor: T.main, borderColor: T.main }]}>{agree ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
          <Text style={styles.agreeText}>I agree to the Terms and Privacy policy.</Text>
        </Pressable>
        {error && <ErrorNote text={error} />}
        <ArrowButton
          tone={T}
          title="Create my free account"
          loading={busy}
          disabled={!agree}
          onPress={() =>
            run(async () => {
              if (name.trim().length < 2) return setError("Enter your name.");
              await session.verifyPhone(mode.phone, mode.code, name.trim()).catch((e) => setError(say(e, "Couldn't create your account.")));
            })
          }
        />
        <Text style={styles.mutedCenter}>No company needed. Nothing is shared until you accept.</Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell back={router.canGoBack()} photo="driver" title="Drive with" accent="RIO GPS" tagline="One free account for every carrier and broker you drive for." cardKey="phone">
      <RoleSwitch active="driver" onChange={toFleet} />
      <Text style={styles.h1}>Your mobile number</Text>
      <Field label="Mobile" icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="(416) 555-0142" />
      <Text style={styles.muted}>Carriers and brokers find you by this number.</Text>
      {error && <ErrorNote text={error} />}
      <ArrowButton
        tone={T}
        title="Continue"
        loading={busy}
        onPress={() =>
          run(async () => {
            if (phone.replace(/\D/g, "").length < 10) return setError("Enter your 10-digit mobile number.");
            try {
              const start = await session.startPhone(phone.trim());
              setCode("");
              setMode({ m: "code", phone: phone.trim(), start });
            } catch (e) {
              setError(say(e, "Couldn't send a code. Try again."));
            }
          })
        }
      />
      <Note tone={T} icon="sparkles-outline" bold="New here?" text="Same screen. We make your free account after the code. No company needed." />
      <Text style={styles.link} onPress={() => setMode({ m: "paste" })}>
        Got a link from your company?
      </Text>
    </AuthShell>
  );
}

const styles = themed(() => ({
  flexShrink: { flexShrink: 1 },
  h1: { fontSize: 18, fontWeight: "800", textAlign: "center", color: colors.foreground },
  who: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 10, borderRadius: 16, backgroundColor: T.soft },
  whoName: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  whoCompany: { fontSize: 13, fontWeight: "600", color: T.ink },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  muted: { fontSize: 12.5, color: colors.mutedForeground },
  mutedCenter: { fontSize: 12.5, color: colors.mutedForeground, textAlign: "center" },
  link: { fontSize: 14, fontWeight: "600", color: colors.primary, textAlign: "center" },
  linkSmall: { fontSize: 13, fontWeight: "700", color: colors.primary },
  confirmed: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 14, backgroundColor: "#dcf3e4" },
  confirmedText: { fontSize: 14, color: "#0f5c2c" },
  agree: { flexDirection: "row", alignItems: "center", gap: 10 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  agreeText: { flex: 1, fontSize: 13, color: colors.foreground }
}));
