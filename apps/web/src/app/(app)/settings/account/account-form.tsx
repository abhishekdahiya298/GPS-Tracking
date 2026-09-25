"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth-client";

const input = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" } as const;

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = String(f.get("newPassword") ?? "");
    if (next !== String(f.get("confirm") ?? "")) {
      setMsg({ ok: false, text: "The new passwords do not match." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.changePassword({
      currentPassword: String(f.get("currentPassword") ?? ""),
      newPassword: next,
      revokeOtherSessions: true
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.status === 429 ? "Too many attempts. Try again in a minute." : error.message || "Could not change the password." });
      return;
    }
    form.reset();
    setMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 420, margin: "6vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22 }}>My account</h1>
      <p style={{ color: "#5b6470", wordBreak: "break-all" }}>
        {name} · {email}
      </p>
      <h2 style={{ fontSize: 17 }}>Change password</h2>
      <form method="post" onSubmit={onSubmit}>
        <label>
          Current password
          <input name="currentPassword" type="password" autoComplete="current-password" required style={input} />
        </label>
        <label>
          New password (min. 12 characters)
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} style={input} />
        </label>
        <label>
          Confirm new password
          <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} style={input} />
        </label>
        {msg && (
          <p role="status" style={{ color: msg.ok ? "#1c7a36" : "#b00020" }}>
            {msg.text}
          </p>
        )}
        <button type="submit" disabled={busy} style={{ padding: "10px 16px", fontSize: 16 }}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </main>
  );
}
