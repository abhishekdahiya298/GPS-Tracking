"use client";
import { useState, type FormEvent } from "react";
import type { MemberDto } from "@/lib/team";

const ROLES = ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER", "VIEWER"] as const;
const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org Admin", FLEET_MANAGER: "Fleet Manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (res.status === 401) {
    window.location.assign("/login?next=/settings/team");
    throw new Error("Signed out");
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body;
}

const box = { border: "1px solid #e3e6ea", borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const input = { padding: 8, fontSize: 15, minWidth: 0, boxSizing: "border-box" } as const;

function ago(iso: string | null) {
  if (!iso) return "never signed in";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "signed in today" : `last sign-in ${d} d ago`;
}

export function TeamManager({ initialMembers, you, canManage }: { initialMembers: MemberDto[]; you: string; canManage: boolean }) {
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One-time secret display. Kept only in memory; cleared on dismiss.
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      const list = await api("/api/team");
      setMembers(list.members);
      return out;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get("email") ?? "");
    const out = await run(() => api("/api/team", { method: "POST", body: JSON.stringify({ email, name: f.get("name"), role: f.get("role") }) }));
    if (out) {
      form.reset();
      if (out.temporaryPassword) setSecret({ email, password: out.temporaryPassword });
      else if (out.emailed) setNotice(`Invitation email sent to ${email}.`);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Team</h1>
        <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/map">Live map</a>
          <a href="/vehicles">Vehicles</a>
          <a href="/settings/account">My account</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      {notice && (
        <p role="status" style={{ color: "#1c7a36" }}>
          {notice}{" "}
          <button type="button" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      )}

      {secret && (
        <div style={{ ...box, background: "#fff8e1", borderColor: "#f0c36d" }}>
          <strong>Temporary password for {secret.email}</strong>
          <p style={{ margin: "8px 0" }}>
            Share it privately. It is shown <strong>only once</strong>; ask them to change it under “My account” after signing in.
          </p>
          <code style={{ fontSize: 18, padding: "6px 10px", background: "#fff", border: "1px solid #e3e6ea", borderRadius: 6, display: "inline-block", userSelect: "all", wordBreak: "break-all" }}>
            {secret.password}
          </code>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button type="button" onClick={() => navigator.clipboard?.writeText(secret.password)}>
              Copy
            </button>
            <button type="button" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <section style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Members ({members.length})</h2>
        {members.map((m) => (
          <div key={m.userId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #f0f2f4" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>
                {m.name} {m.userId === you && <span style={{ fontWeight: 400, color: "#5b6470" }}>(you)</span>}
              </strong>
              <div style={{ color: "#5b6470", fontSize: 13, wordBreak: "break-all" }}>
                {m.email} · {ago(m.lastSignInAt)}
              </div>
            </div>
            {canManage ? (
              <select
                aria-label={`Role for ${m.name}`}
                value={m.role}
                disabled={busy}
                onChange={(e) => run(() => api(`/api/team/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))}
                style={input}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span>{ROLE_LABEL[m.role]}</span>
            )}
            {canManage && m.userId !== you && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`Reset ${m.name}'s password? They will be signed out everywhere.`)) return;
                    const out = await run(() => api(`/api/team/${m.userId}/reset-password`, { method: "POST" }));
                    if (out?.temporaryPassword) setSecret({ email: m.email, password: out.temporaryPassword });
                    else if (out?.emailed) setNotice(`Password reset email sent to ${m.email}. Their old password no longer works.`);
                  }}
                >
                  Reset password
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm(`Remove ${m.name} from the organization?`) && run(() => api(`/api/team/${m.userId}`, { method: "DELETE" }))}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </section>

      {canManage && (
        <section style={box}>
          <h2 style={{ fontSize: 17, marginTop: 0 }}>Add a member</h2>
          <form onSubmit={onAdd} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input name="name" required maxLength={200} placeholder="Full name" aria-label="Full name" style={{ ...input, flex: 1, minWidth: 160 }} />
            <input name="email" type="email" required maxLength={254} placeholder="Email" aria-label="Email" style={{ ...input, flex: 1, minWidth: 200 }} />
            <select name="role" defaultValue="VIEWER" aria-label="Role" style={input}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy}>
              Add member
            </button>
          </form>
          <p style={{ color: "#5b6470", fontSize: 13, marginBottom: 0 }}>
            New people get an invitation email with a link to set their password. If email can&apos;t be sent, a one-time temporary password is shown here instead.
          </p>
        </section>
      )}
    </main>
  );
}
