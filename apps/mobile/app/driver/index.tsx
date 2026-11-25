import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ApiError } from "@/api";
import { signup } from "@/auth/signup";
import { AuthShell, LinkCard } from "@/components/AuthShell";
import { Button, ErrorNote, Field } from "@/components/ui";
import { driver, type InvitePeek } from "@/driver/api";
import { useDriverSession } from "@/driver/DriverSession";
import { inviteToken } from "@/driver/model";
import { colors, space, themed } from "@/theme";

type Mode = { m: "phone" } | { m: "code"; phone: string; sentTo: string | null } | { m: "invite"; token: string } | { m: "join" } | { m: "joinCode"; token: string; company: string } | { m: "joined"; company: string } | { m: "paste" };

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Driver sign-in (D1, D1B, D1C, D1D). Opened by the invite link (riogps://driver?t=…), from
 * "Driver?" on Sign in, or from "I'm a driver" on Create account (?join=1).
 */
export default function DriverSignIn() {
  const params = useLocalSearchParams<{ t?: string; join?: string }>();
  const session = useDriverSession();
  const [mode, setMode] = useState<Mode>(() => (params.t ? { m: "invite", token: params.t } : params.join ? { m: "join" } : { m: "phone" }));
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
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

  const others = (
    <>
      {mode.m !== "phone" && mode.m !== "code" ? <LinkCard icon="call-outline" color="#1d4ed8" soft="#dbe4f8" title="Sign in with your phone" detail="We text you a code" onPress={() => setMode({ m: "phone" })} /> : null}
      {mode.m !== "paste" && mode.m !== "invite" ? <LinkCard icon="link-outline" color="#136c35" soft="#c8e8d2" title="Have an invite link?" detail="Open it on this phone, or paste it here" onPress={() => setMode({ m: "paste" })} /> : null}
      {mode.m !== "join" && mode.m !== "joinCode" ? <LinkCard icon="keypad-outline" color="#a3470a" soft="#fcd9b2" title="Join with a company code" detail="Your company approves you" onPress={() => setMode({ m: "join" })} /> : null}
    </>
  );

  if (mode.m === "invite") {
    const ok = peek?.state === "ok";
    const initials = (peek?.driverName ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
    return (
      <AuthShell back title="You're invited" tagline="Opened from your invite link. No password needed." footer="The link works once" below={others}>
        {!peek ? (
          <ActivityIndicator color={colors.primary} />
        ) : ok ? (
          <>
            <View style={styles.who}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.flexShrink}>
                <Text style={styles.whoName}>{peek.driverName}</Text>
                <Text style={styles.whoCompany}>Joining {peek.companyName}</Text>
              </View>
            </View>
            <Text style={styles.h2}>Join {peek.companyName}</Text>
            <Step n={1} text="Your truck and loads appear here" />
            <Step n={2} text="Location is shared while you're signed in" />
            {error && <ErrorNote text={error} />}
            <Button title={`Continue as ${(peek.driverName ?? "").split(" ")[0]}`} onPress={() => run(async () => session.signInWithInvite(mode.token).catch((e) => setError(say(e, "Couldn't sign in. Try again."))))} loading={busy} />
          </>
        ) : (
          <ErrorNote text={peek.state === "used" ? "This link was already used. Ask your company for a new one." : peek.state === "expired" ? "This link has expired. Ask your company to send a new one." : "This link isn't valid. Ask your company to send it again."} />
        )}
      </AuthShell>
    );
  }

  if (mode.m === "paste") {
    return (
      <AuthShell back title="Your invite link" tagline="Paste the link your company sent you." below={others}>
        <Field label="Invite link" icon="link-outline" value={link} onChangeText={setLink} placeholder="https://app.riogps.com/driver-app?t=…" autoCapitalize="none" autoCorrect={false} />
        {error && <ErrorNote text={error} />}
        <Button
          title="Continue"
          icon="arrow-forward"
          onPress={() => {
            const t = inviteToken(link);
            if (!t) return setError("That doesn't look like an invite link. Copy the whole link from the message.");
            setError(null);
            setMode({ m: "invite", token: t });
          }}
        />
      </AuthShell>
    );
  }

  if (mode.m === "code") {
    return (
      <AuthShell back title="Check your texts" tagline={`We sent a 6-digit code to ${mode.sentTo ?? mode.phone}.`} footer="Codes expire after 10 minutes">
        <Field label="Enter the code" icon="keypad-outline" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoFocus maxLength={6} />
        {error && <ErrorNote text={error} />}
        <Button title="Verify and continue" icon="arrow-forward" onPress={() => run(async () => session.verifyPhone(mode.phone, code).catch((e) => setError(say(e, "That code didn't work."))))} loading={busy} />
        <Text style={styles.link} onPress={() => setMode({ m: "phone" })}>
          Change number
        </Text>
      </AuthShell>
    );
  }

  if (mode.m === "join" || mode.m === "joinCode") {
    return (
      <AuthShell back title="Join your company" tagline="Enter the code your company gave you." below={others}>
        {mode.m === "join" ? (
          <>
            <Field label="Company code" icon="keypad-outline" value={companyCode} onChangeText={(v) => setCompanyCode(v.toUpperCase())} placeholder="DHILLON-4821" autoCapitalize="characters" autoCorrect={false} />
            <Field label="Your name" icon="person-outline" value={name} onChangeText={setName} autoComplete="name" />
            <Field label="Mobile number" icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="(647) 555-0144" />
            {error && <ErrorNote text={error} />}
            <Button
              title="Send my code"
              onPress={() =>
                run(async () => {
                  try {
                    const r = await signup.joinCompany(companyCode.trim(), name.trim(), phone.trim());
                    setMode(r.status === "code_sent" ? { m: "joinCode", token: r.token, company: r.companyName } : { m: "joined", company: r.companyName });
                  } catch (e) {
                    setError(say(e, "Couldn't check that code."));
                  }
                })
              }
              loading={busy}
            />
          </>
        ) : (
          <>
            <Text style={styles.h2}>Enter the code we sent you</Text>
            <Field label="Code" icon="keypad-outline" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus />
            {error && <ErrorNote text={error} />}
            <Button
              title="Verify"
              onPress={() =>
                run(async () => {
                  try {
                    await signup.verify(mode.token, code.trim());
                    setCode("");
                    setMode({ m: "joined", company: mode.company });
                  } catch (e) {
                    setError(say(e, "That code didn't work."));
                  }
                })
              }
              loading={busy}
            />
          </>
        )}
      </AuthShell>
    );
  }

  if (mode.m === "joined") {
    return (
      <AuthShell back title="You're on the list" tagline={`${mode.company} has added you as a driver.`}>
        <View style={styles.who}>
          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
          <Text style={styles.flexShrink}>Sign in with your phone number to start. Nothing is shared until you allow location.</Text>
        </View>
        <Button title="Sign in with my phone" icon="arrow-forward" onPress={() => setMode({ m: "phone" })} />
      </AuthShell>
    );
  }

  return (
    <AuthShell back title="Driver sign in" tagline="Get your loads. Your company sees your location while you're signed in." below={others}>
      <Text style={styles.h2}>Your mobile number</Text>
      <Field label="Mobile number" icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="(416) 555-0142" />
      <Text style={styles.muted}>Use the number your company added for you.</Text>
      {error && <ErrorNote text={error} />}
      <Button
        title="Text me a code"
        icon="chatbubble-outline"
        onPress={() =>
          run(async () => {
            if (phone.replace(/\D/g, "").length < 10) return setError("Enter your 10-digit mobile number.");
            try {
              const r = await session.startPhone(phone.trim());
              setCode("");
              setMode({ m: "code", phone: phone.trim(), sentTo: r.sentTo });
            } catch (e) {
              setError(`${say(e, "Couldn't send a code.")} You can also ask your company for an invite link.`);
            }
          })
        }
        loading={busy}
      />
    </AuthShell>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepN}>
        <Text style={styles.stepNText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = themed(() => ({
  flexShrink: { flexShrink: 1, color: colors.foreground, fontSize: 14 },
  who: { flexDirection: "row", alignItems: "center", gap: space.md, alignSelf: "center", paddingVertical: 6, paddingLeft: 6, paddingRight: 16, borderRadius: 99, backgroundColor: colors.successSoft },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#133a9e", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  whoName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  whoCompany: { fontSize: 12.5, fontWeight: "600", color: colors.success },
  h2: { fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 10, borderRadius: 12, backgroundColor: colors.muted },
  stepN: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stepNText: { fontWeight: "800", color: colors.primary },
  stepText: { flex: 1, fontSize: 13.5, color: colors.foreground },
  muted: { fontSize: 13, color: colors.mutedForeground, marginTop: -space.xs },
  link: { fontSize: 14, fontWeight: "600", color: colors.primary, textAlign: "center" }
}));
