"use client";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/client/auth-client";

export function ForgotForm() {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "limited">("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same message whether or not the account exists (no account enumeration).
    setState(error?.status === 429 ? "limited" : "sent");
  }

  if (state === "sent") {
    return <Alert tone="success" title="Check your email">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</Alert>;
  }
  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-10 text-base sm:text-sm" />
      </Field>
      {state === "limited" && <Alert tone="danger" title="Too many requests. Please wait a few minutes." />}
      <Button type="submit" size="lg" loading={state === "busy"} className="w-full">
        {state === "busy" ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
