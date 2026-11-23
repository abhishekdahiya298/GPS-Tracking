"use client";
import { ArrowLeft, Building2, CheckCircle2, Package, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { deviceTimeZone, TimeZoneSelect } from "@/components/app/time-zone-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { AuthHeading } from "../auth-heading";

type Role = "fleet" | "operator" | "broker" | "driver";
const ROLES: { key: Role; title: string; hint: string; icon: typeof Truck }[] = [
  { key: "fleet", title: "I run trucks", hint: "Fleet owner or manager. Add your trucks and drivers.", icon: Building2 },
  { key: "operator", title: "I'm an owner-operator", hint: "I own my truck and drive it myself.", icon: Truck },
  { key: "broker", title: "I book loads", hint: "Broker or dispatcher. Track loads with the driver's phone.", icon: Package },
  { key: "driver", title: "I'm a driver", hint: "I drive for a company. Needs your company's code.", icon: UserRound }
];
const SIZES = ["1", "2-5", "6-20", "21-50", "50+"] as const;

type Step = { s: "role" } | { s: "details" } | { s: "code"; token: string; phone: string; companyName?: string } | { s: "joined"; companyName: string };

/**
 * Create account: what describes you → your company (or the company code for drivers) → the
 * code texted to your phone. The company opens on the plan RIO chose for that role.
 */
export function SignupFlow({ open, phoneCheck, initialRole, initialCode }: { open: Record<Role, boolean>; phoneCheck: boolean; initialRole: Role | null; initialCode: string }) {
  const roles = ROLES.filter((r) => open[r.key]);
  const [role, setRole] = useState<Role>(initialRole && open[initialRole] ? initialRole : roles[0]!.key);
  const [step, setStep] = useState<Step>(initialRole && open[initialRole] ? { s: "details" } : { s: "role" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const total = phoneCheck ? 3 : 2;
  const tzRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const tz = deviceTimeZone();
    if (tz && tzRef.current && [...tzRef.current.options].some((o) => o.value === tz)) tzRef.current.value = tz;
  }, [step.s, role]);

  async function submitCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const body = {
        role,
        company: String(f.get("company") ?? ""),
        name: String(f.get("name") ?? ""),
        phone: String(f.get("phone") ?? ""),
        email: String(f.get("email") ?? ""),
        password,
        fleetSize: String(f.get("fleetSize") ?? "1"),
        country: String(f.get("country") ?? "CA"),
        timeZone: String(f.get("timeZone") ?? "America/Toronto"),
        agree: f.get("agree") === "on"
      };
      const r = await api<{ status: string; token?: string; phone?: string }>("/api/signup/start", { method: "POST", json: body });
      if (r.status === "created") window.location.assign("/dashboard?welcome=1");
      else setStep({ s: "code", token: r.token!, phone: r.phone! });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ status: string; token?: string; phone?: string; companyName: string }>("/api/signup/join", {
        method: "POST",
        json: { code: String(f.get("code") ?? ""), name: String(f.get("name") ?? ""), phone: String(f.get("phone") ?? "") }
      });
      if (r.status === "joined") setStep({ s: "joined", companyName: r.companyName });
      else setStep({ s: "code", token: r.token!, phone: r.phone!, companyName: r.companyName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (step.s !== "code") return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ status: string; companyName?: string }>("/api/signup/verify", { method: "POST", json: { token: step.token, code, password: role === "driver" ? undefined : password } });
      if (r.status === "created") window.location.assign("/dashboard?welcome=1");
      else setStep({ s: "joined", companyName: r.companyName ?? step.companyName ?? "your company" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (step.s !== "code") return;
    setError(null);
    try {
      const r = await api<{ phone: string }>("/api/signup/resend", { method: "POST", json: { token: step.token } });
      setStep({ ...step, phone: r.phone });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const back = (
    <button type="button" onClick={() => { setError(null); setStep({ s: "role" }); }} className="mb-3 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-primary">
      <ArrowLeft className="size-4" aria-hidden="true" /> Back
    </button>
  );

  if (step.s === "joined") {
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <CheckCircle2 className="size-14 text-success" aria-hidden="true" />
        <AuthHeading title={`You're in ${step.companyName}`} description="Your company sees you as a driver now. They'll send you a link for each load; open it on your phone to share your location while you're on duty." />
        <Link href="/login" className="text-sm text-primary">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (step.s === "code") {
    return (
      <form onSubmit={verify} className="grid gap-4">
        <p className="m-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Step {total} of {total}
        </p>
        <AuthHeading title="Check your phone" description={`We sent a 6-digit code by text to ${step.phone}.`} />
        <Field id="code" label="Code" required>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-12 text-center text-2xl tracking-[0.5em]" autoFocus />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="h-11">
          {role === "driver" ? "Verify and join" : "Verify and start"}
        </Button>
        <p className="m-0 text-center text-sm text-muted-foreground">
          Didn&apos;t get it?{" "}
          <button type="button" onClick={() => void resend()} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-primary">
            Send again
          </button>{" "}
          ·{" "}
          <button type="button" onClick={() => setStep({ s: "details" })} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-primary">
            Change number
          </button>
        </p>
        {role !== "driver" && (
          <ul className="m-0 grid list-none gap-1.5 rounded-xl bg-muted/60 p-3 text-sm">
            <li>✓ Your company opens on the Free Basic plan</li>
            <li>✓ A short checklist helps you add a truck and a driver</li>
            <li>✓ Our team can show you the paid features</li>
          </ul>
        )}
      </form>
    );
  }

  if (step.s === "role") {
    return (
      <div className="grid gap-4">
        <p className="m-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">Step 1 of {total}</p>
        <AuthHeading title="Create your free account" description="What describes you best? We'll set up RIO GPS to match." />
        <div role="radiogroup" aria-label="I am" className="grid gap-2">
          {roles.map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={role === r.key}
              onClick={() => setRole(r.key)}
              className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-background p-3 text-left", role === r.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}
            >
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", role === r.key ? "bg-primary text-primary-foreground" : "bg-muted text-primary")}>
                <r.icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <b className="block text-[15px]">{r.title}</b>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <Button className="h-11" onClick={() => setStep({ s: "details" })}>
          Continue
        </Button>
        <p className="m-0 text-center text-sm text-muted-foreground">
          Waiting for a delivery? You don&apos;t need an account: open the tracking link your carrier sent you.
        </p>
        <p className="m-0 text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (role === "driver") {
    return (
      <form onSubmit={submitJoin} className="grid gap-4">
        {roles.length > 1 && back}
        <p className="m-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">Driver</p>
        <AuthHeading title="Join your company" description="Drivers join the company they drive for. Your company sends you a link or a code." />
        <Field id="code" label="Company code" required>
          <Input id="code" name="code" required defaultValue={initialCode} autoCapitalize="characters" placeholder="DHILLON-4821" />
        </Field>
        <Field id="name" label="Your name" required>
          <Input id="name" name="name" required autoComplete="name" />
        </Field>
        <Field id="phone" label="Mobile phone" required description={phoneCheck ? "We'll text you a code to confirm." : undefined}>
          <Input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="(905) 555-0121" />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="h-11">
          Join company
        </Button>
        <p className="m-0 text-xs text-muted-foreground">No code? Ask the person who runs your trucks to add you in RIO GPS. Your company sees your location only while you&apos;re on duty.</p>
      </form>
    );
  }

  return (
    <form onSubmit={submitCompany} className="grid gap-3.5">
      {back}
      <p className="m-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Step 2 of {total} · {ROLES.find((r) => r.key === role)!.title.replace(/^I( am|'m)? ?/i, "")}
      </p>
      <AuthHeading title="Your company" description="You'll be the admin. You can add your team and drivers next." />
      <Field id="company" label="Company name" required>
        <Input id="company" name="company" required maxLength={80} autoComplete="organization" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="name" label="Your name" required>
          <Input id="name" name="name" required maxLength={80} autoComplete="name" />
        </Field>
        <Field id="phone" label="Mobile phone" required>
          <Input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="(905) 555-0121" />
        </Field>
      </div>
      <Field id="email" label="Work email" required>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field id="password" label="Password" required description="At least 10 characters.">
        <PasswordInput id="password" name="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {role !== "broker" && (
        <fieldset className="m-0 grid gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">How many trucks do you run?</legend>
          <div className="flex flex-wrap gap-1.5">
            {SIZES.map((s, i) => (
              <label key={s} className="cursor-pointer">
                <input type="radio" name="fleetSize" value={s} defaultChecked={role === "operator" ? i === 0 : i === 1} className="peer sr-only" />
                <span className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-sm font-semibold peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                  {s}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="country" label="Country">
          <Select id="country" name="country" defaultValue="CA">
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </Select>
        </Field>
        <Field id="timeZone" label="Time zone">
          <TimeZoneSelect ref={tzRef} id="timeZone" name="timeZone" defaultValue="America/Toronto" />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="agree" required className="mt-0.5" /> <span>I agree to the <a href="https://riogps.com/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="https://riogps.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a></span>
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" loading={busy} className="h-11">
        Create free account
      </Button>
    </form>
  );
}
