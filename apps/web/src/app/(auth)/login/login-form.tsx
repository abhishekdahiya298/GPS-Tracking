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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? "")
    });
    if (err) {
      setPending(false);
      // Generic message: never reveal whether the email exists.
      setError(err.status === 429 ? "Too many attempts. Wait a minute and try again." : "Invalid email or password.");
      return;
    }
    window.location.assign(next);
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
