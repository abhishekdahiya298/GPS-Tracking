"use client";
import { useState, type FormEvent } from "react";
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
    setPending(false);
    if (err) {
      // Generic message: never reveal whether the email exists.
      setError(err.status === 429 ? "Too many attempts. Wait a minute and try again." : "Invalid email or password.");
      return;
    }
    window.location.assign(next);
  }

  const input = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" } as const;
  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required style={input} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required minLength={12} style={input} />
      </label>
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} style={{ padding: "10px 16px", fontSize: 16 }}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
