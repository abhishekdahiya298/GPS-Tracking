"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/client/auth-client";

export function ResetForm({ token }: { token: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
      <Field id="newPassword" label="New password" description="At least 12 characters.">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="h-10 text-base sm:text-sm" />
      </Field>
      <Field id="confirm" label="Confirm password">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="h-10 text-base sm:text-sm" />
      </Field>
      {msg && <Alert tone="danger" title={msg} />}
      <Button type="submit" size="lg" loading={busy} className="w-full">
        {busy ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
