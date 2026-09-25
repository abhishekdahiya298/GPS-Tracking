"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth-client";

const input = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" } as const;

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
      <p role="status">
        Password set. <a href="/login">Sign in</a>
      </p>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit}>
      <label>
        New password (min. 12 characters)
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} style={input} />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} style={input} />
      </label>
      {msg && (
        <p role="alert" style={{ color: "#b00020" }}>
          {msg}
        </p>
      )}
      <button type="submit" disabled={busy} style={{ padding: "10px 16px", fontSize: 16 }}>
        {busy ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
