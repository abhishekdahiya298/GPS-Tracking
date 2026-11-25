"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "../password-strength";

/** New passwords: the same 10-character minimum as Create account. */
const MIN_NEW = 10;
import { authClient } from "@/lib/client/auth-client";

export function ResetForm({ token }: { token: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [pw, setPw] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get("newPassword") ?? "");
    if (newPassword !== String(f.get("confirm") ?? "")) {
      setMsg("The passwords do not match.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setBusy(false);
    if (error) {
      setMsg(error.status === 400 ? "This link is invalid or has expired. Request a new one." : error.message || "Could not set the password.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Alert tone="success" title="Password set">
        <Link href="/login" className="text-primary">
          Sign in
        </Link>
      </Alert>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field id="newPassword" label="New password">
        <PasswordInput id="newPassword" name="newPassword" autoComplete="new-password" required minLength={MIN_NEW} maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)} className="h-10 text-base sm:text-sm" />
      </Field>
      <Field id="confirm" label="Confirm new password">
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required minLength={MIN_NEW} maxLength={128} className="h-10 text-base sm:text-sm" />
      </Field>
      <PasswordStrength value={pw} min={MIN_NEW} />
      {msg && <Alert tone="danger" title={msg} />}
      <Button type="submit" size="lg" loading={busy} className="w-full">
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
