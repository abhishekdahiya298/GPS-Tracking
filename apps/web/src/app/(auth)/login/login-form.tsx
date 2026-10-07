"use client";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/client/auth-client";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Second step, shown only when the account has two-step verification on.
  const [second, setSecond] = useState<null | "app" | "backup">(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error: err } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? "")
    });
    if (err) {
      setPending(false);
      // Generic message: never reveal whether the email exists.
      setError(err.status === 429 ? "Too many attempts. Wait a minute and try again." : "Invalid email or password.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setPending(false);
      setSecond("app");
      return;
    }
    window.location.assign(next);
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const entered = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const { error: err } = second === "backup" ? await authClient.twoFactor.verifyBackupCode({ code: entered }) : await authClient.twoFactor.verifyTotp({ code: entered.replace(/\s/g, "") });
    if (err) {
      setPending(false);
      const code = "code" in err ? String(err.code ?? "") : "";
      if (code === "INVALID_TWO_FACTOR_COOKIE" || code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
        // The 10-minute window for the second step ran out, or too many wrong codes: start again.
        setSecond(null);
        setError(code === "INVALID_TWO_FACTOR_COOKIE" ? "That took too long. Sign in again." : "Too many wrong codes. Sign in again.");
      } else if (code === "ACCOUNT_TEMPORARILY_LOCKED") setError("Too many wrong codes. Two-step sign-in is paused for a while. Try again later.");
      else if (err.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else setError(second === "backup" ? "That backup code is not valid or was already used." : "That code did not match. Try the newest code from your app.");
      return;
    }
    window.location.assign(next);
  }

  if (second) {
    const backup = second === "backup";
    return (
      <form key={second} method="post" onSubmit={onCode} noValidate className="grid gap-4">
        <p className="m-0 text-sm text-muted-foreground" role="status">
          {backup ? "Enter one of the backup codes you saved when you turned on two-step verification." : "Enter the 6-digit code from your authenticator app."}
        </p>
        <Field id="code" label={backup ? "Backup code" : "Verification code"}>
          <Input
            id="code"
            name="code"
            autoFocus
            required
            autoComplete={backup ? "off" : "one-time-code"}
            inputMode={backup ? "text" : "numeric"}
            maxLength={backup ? 32 : 7}
            className="h-10 text-base tracking-widest sm:text-sm"
          />
        </Field>
        {error && <Alert tone="danger" title={error} />}
        <Button type="submit" size="lg" loading={pending} className="w-full">
          {pending ? "Checking…" : "Verify"}
        </Button>
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); setSecond(backup ? "app" : "backup"); }}>
            {backup ? "Use the authenticator app" : "Use a backup code"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); setSecond(null); }}>
            Start again
          </Button>
        </div>
      </form>
    );
  }

  // method="post": if JS hasn't loaded yet, credentials never go into the URL.
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-10 text-base sm:text-sm" />
      </Field>
      <Field id="password" label="Password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={12} className="h-10 text-base sm:text-sm" />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
