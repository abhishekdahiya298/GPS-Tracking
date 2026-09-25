"use client";

import { useState, type FormEvent } from "react";
import type { CustomerDto } from "@/lib/customers";

async function call(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

const box = { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 } as const;

export function CustomersManager({ initial, viewingAs }: { initial: CustomerDto[]; viewingAs: string | null }) {
  const [customers, setCustomers] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/admin/customers", { cache: "no-store" });
    if (res.ok) setCustomers((await res.json()).customers);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    setSecret(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(async () => {
      const out = await call("/api/admin/customers", {
        name: f.get("name"),
        slug: f.get("slug"),
        admin: { name: f.get("adminName"), email: f.get("adminEmail") }
      });
      setSecret(out.admin.temporaryPassword);
      setMsg({ ok: true, text: out.admin.emailed ? "Customer created. The admin was emailed an invitation link." : "Customer created. Give the admin this one-time password:" });
      form.reset();
      await refresh();
    });
  }

  function onDevice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(async () => {
      const name = String(f.get("name") ?? "").trim();
      const out = await call(`/api/admin/customers/${f.get("customer")}/devices`, { imei: f.get("imei"), model: f.get("model"), ...(name ? { name } : {}) });
      setMsg({ ok: true, text: out.traccarCreated ? "Device registered in Traccar and RIO." : "Device already existed in Traccar; linked in RIO." });
      form.reset();
      await refresh();
    });
  }

  function viewAs(organizationId: string | null) {
    void run(async () => {
      await call("/api/admin/view-as", { organizationId });
      window.location.assign(organizationId ? "/dashboard" : "/admin/customers");
    });
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 960 }}>
      <p>
        <a href="/dashboard">← Dashboard</a>
      </p>
      <h1 style={{ fontSize: 22 }}>Customers</h1>
      {viewingAs && (
        <p style={{ background: "#fff4d6", padding: 8, borderRadius: 6 }}>
          You are currently viewing as a customer. <button onClick={() => viewAs(null)} disabled={busy}>Exit view-as</button>
        </p>
      )}
      {msg && (
        <div role="status" style={{ ...box, borderColor: msg.ok ? "#2a7" : "#c33" }}>
          {msg.text}
          {secret && <code style={{ display: "block", marginTop: 8, fontSize: 16 }}>{secret}</code>}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Name</th><th>Slug</th><th>Users</th><th>Devices</th><th>Created</th><th />
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{c.name}</td>
              <td><code>{c.slug}</code></td>
              <td>{c.members}</td>
              <td>{c.devices}</td>
              <td>{new Date(c.createdAt).toLocaleDateString()}</td>
              <td><button onClick={() => viewAs(c.id)} disabled={busy}>View as</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form method="post" onSubmit={onCreate} style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>New customer</h2>
        <p style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label>Company name<br /><input name="name" required minLength={2} maxLength={120} /></label>
          <label>Short name (slug)<br /><input name="slug" required pattern="[a-z0-9](?:[a-z0-9\-]{0,48}[a-z0-9])?" placeholder="acme-logistics" /></label>
          <label>First admin name<br /><input name="adminName" required maxLength={200} /></label>
          <label>First admin email<br /><input name="adminEmail" type="email" required maxLength={254} /></label>
        </p>
        <button type="submit" disabled={busy}>Create customer</button>
      </form>

      <form method="post" onSubmit={onDevice} style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Register a device</h2>
        <p style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label>Customer<br />
            <select name="customer" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>IMEI (15 digits)<br /><input name="imei" required inputMode="numeric" pattern="\d{15}" /></label>
          <label>Model<br /><input name="model" required defaultValue="FTM880" maxLength={60} /></label>
          <label>Name in Traccar (optional)<br /><input name="name" maxLength={80} /></label>
        </p>
        <button type="submit" disabled={busy}>Register device</button>
        <p style={{ fontSize: 13, color: "#555" }}>Registers the IMEI in Traccar (if not already there) and assigns it to the customer in RIO. Then configure the tracker to report to tracker.riocaliforniainc.com:5027 and assign it to a vehicle.</p>
      </form>
    </main>
  );
}
