"use client";
import { Check, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { encode } from "uqr";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { authClient } from "@/lib/client/auth-client";

type Step = { kind: "idle" } | { kind: "password"; purpose: "enable" | "disable" | "codes" } | { kind: "scan"; uri: string; codes: string[] } | { kind: "codes"; codes: string[]; fresh: boolean };

function message(err: { status?: number; message?: string }, fallback: string): string {
  if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
  return err.message || fallback;
}

/** Two-step verification: an authenticator app code at every sign-in, with one-time backup codes. */
export function TwoStepCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "password") return;
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      if (step.purpose === "enable") {
        const { data, error: err } = await authClient.twoFactor.enable({ password });
        if (err || !data || !("totpURI" in data)) return setError(message(err ?? {}, "Could not start setup. Check your password."));
        go({ kind: "scan", uri: data.totpURI, codes: data.backupCodes });
      } else if (step.purpose === "disable") {
        const { error: err } = await authClient.twoFactor.disable({ password });
        if (err) return setError(message(err, "Could not turn it off. Check your password."));
        setOn(false);
        go({ kind: "idle" });
        toast.success("Two-step verification is off.");
        router.refresh();
      } else {
        const { data, error: err } = await authClient.twoFactor.generateBackupCodes({ password });
        if (err || !data) return setError(message(err ?? {}, "Could not create new codes. Check your password."));
        go({ kind: "codes", codes: data.backupCodes, fresh: false });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (err) return setError(err.status === 429 ? message(err, "") : "That code did not match. Check the time on your phone and try the newest code.");
    setOn(true);
    go({ kind: "codes", codes: step.codes, fresh: true });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" /> Two-step verification
            <Badge tone={on ? "success" : "neutral"}>{on ? "On" : "Off"}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <div className="grid min-w-0 gap-4 p-4 pt-0">
        {step.kind === "idle" && (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              {on
                ? "Signing in asks for your password and a 6-digit code from your authenticator app."
                : "Add a second step when you sign in: a 6-digit code from an authenticator app on your phone. Even with your password, nobody else can get in."}
            </p>
            <div className="flex flex-wrap gap-2">
              {on ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => go({ kind: "password", purpose: "codes" })}>
                    New backup codes
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => go({ kind: "password", purpose: "disable" })}>
                    <ShieldOff /> Turn off
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => go({ kind: "password", purpose: "enable" })}>
                  <ShieldCheck /> Turn on
                </Button>
              )}
            </div>
          </>
        )}

        {step.kind === "password" && (
          <form method="post" onSubmit={onPassword} className="grid gap-4">
            <p className="m-0 text-sm text-muted-foreground">
              {step.purpose === "enable" && "Confirm your password to start."}
              {step.purpose === "disable" && "Confirm your password to turn two-step verification off."}
              {step.purpose === "codes" && "Confirm your password to create new backup codes. Your old codes stop working."}
            </p>
            <Field id="tsv-pw" label="Password" required>
              <PasswordInput id="tsv-pw" name="password" autoComplete="current-password" required autoFocus />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} variant={step.purpose === "disable" ? "danger" : "primary"}>
                {step.purpose === "disable" ? "Turn off" : "Continue"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => go({ kind: "idle" })}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step.kind === "scan" && (
          <form method="post" onSubmit={onCode} className="grid gap-4">
            <ol className="m-0 grid list-decimal gap-1 pl-5 text-sm">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</li>
              <li>Scan this code, or type the setup key.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-4">
              <QrCode value={step.uri} />
              <div className="grid min-w-0 flex-1 basis-48 gap-1.5">
                <p className="m-0 text-sm font-medium">Setup key</p>
                <code className="break-all rounded-md bg-muted px-3 py-2 text-sm">{secretOf(step.uri)}</code>
                <div>
                  <CopyButton text={secretOf(step.uri)} label="Copy key" />
                </div>
              </div>
            </div>
            <Field id="tsv-code" label="6-digit code" required>
              <Input id="tsv-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="max-w-40 text-base tracking-widest sm:text-sm" />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>
                Confirm and turn on
              </Button>
              <Button type="button" variant="ghost" onClick={() => go({ kind: "idle" })}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step.kind === "codes" && (
          <div className="grid gap-4">
            {step.fresh && <Alert tone="success" title="Two-step verification is on." />}
            <div className="grid gap-1.5">
              <p className="m-0 text-sm font-medium">Backup codes</p>
              <p className="m-0 text-sm text-muted-foreground">Each code works once if you lose your phone. Save them somewhere safe now. They are not shown again.</p>
            </div>
            <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-sm">
              {step.codes.map((c) => (
                <li key={c} className="rounded-md bg-muted px-3 py-2 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={step.codes.join("\n")} label="Copy codes" />
              <Button type="button" onClick={() => go({ kind: "idle" })}>
                I saved them
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          toast.error("Could not copy. Select the text and copy it by hand.");
        }
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "Copied" : label}
    </Button>
  );
}

/** QR drawn in the browser as SVG. The setup key never leaves this page. */
function QrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y]![x]) d += `M${x} ${y}h1v1h-1z`;
    return { d, size };
  }, [value]);
  return (
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${path.size} ${path.size}`} width={168} height={168} shapeRendering="crispEdges" className="shrink-0 rounded-md border border-border bg-white">
      <path d={path.d} fill="#000000" />
    </svg>
  );
}
