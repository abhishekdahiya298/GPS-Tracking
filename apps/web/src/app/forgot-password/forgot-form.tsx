"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth-client";

const input = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" } as const;

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
    return <p role="status">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</p>;
  }
  return (
    <form method="post" onSubmit={onSubmit}>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required style={input} />
      </label>
      {state === "limited" && (
        <p role="alert" style={{ color: "#b00020" }}>
          Too many requests. Please wait a few minutes.
        </p>
      )}
      <button type="submit" disabled={state === "busy"} style={{ padding: "10px 16px", fontSize: 16 }}>
        {state === "busy" ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
