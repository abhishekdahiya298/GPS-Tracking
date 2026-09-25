"use client";

import { useState, type FormEvent } from "react";
import type { ItemDto } from "@/lib/maintenance";

type Opt = { id: string; label: string };
const box = { border: "1px solid #e3e6ea", borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const input = { padding: 6, fontSize: 14, boxSizing: "border-box" } as const;
const BADGE: Record<string, { bg: string; fg: string; text: string }> = {
  ok: { bg: "#e7f6ec", fg: "#146c2e", text: "OK" },
  due_soon: { bg: "#fff4d6", fg: "#8a5a00", text: "Due soon" },
  overdue: { bg: "#fde8e8", fg: "#a61b1b", text: "Overdue" }
};
const PRESETS = [
  { name: "Oil change", km: 10000, days: 180 },
  { name: "Tyre rotation", km: 10000, days: null },
  { name: "Brake inspection", km: 20000, days: 365 },
  { name: "Annual inspection", km: null, days: 365 },
  { name: "Insurance renewal", km: null, days: 365 }
];
const today = () => new Date().toISOString().slice(0, 10);

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  if (res.status === 401) {
    window.location.assign("/login?next=/maintenance");
    throw new Error("Signed out");
  }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

function remaining(i: ItemDto) {
  const parts: string[] = [];
  const s = i.status;
  if (s.kmRemaining !== null) parts.push(s.kmRemaining <= 0 ? `${Math.abs(s.kmRemaining)} km over` : `${s.kmRemaining} km left`);
  if (s.daysRemaining !== null) parts.push(s.daysRemaining <= 0 ? `date passed (${s.dueDate})` : `${s.daysRemaining} days left (by ${s.dueDate})`);
  return parts.join(" · ");
}

export function MaintenanceManager(props: { initial: ItemDto[]; vehicles: Opt[]; members: Opt[]; myUserId: string; canWrite: boolean }) {
  const [items, setItems] = useState(props.initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [servicing, setServicing] = useState<string | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(PRESETS[0]!);

  async function refresh() {
    setItems((await call("GET", "/api/maintenance")).items);
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      await refresh();
      setMsg({ ok: true, text });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(async () => {
      await call("POST", "/api/maintenance", {
        vehicleId: f.get("vehicleId"),
        name: f.get("name"),
        intervalKm: num(f.get("intervalKm")),
        intervalDays: num(f.get("intervalDays")),
        lastServiceAt: new Date(`${f.get("lastServiceAt")}T12:00:00`).toISOString(),
        lastServiceOdometerKm: num(f.get("odometer")),
        notifyUserIds: f.getAll("notify").map(String),
        note: String(f.get("note") ?? "").trim() || null
      });
      form.reset();
      return "Reminder added.";
    });
  }

  function onService(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const d = String(f.get("servicedAt") ?? "");
    void run(async () => {
      await call("POST", `/api/maintenance/${id}/service`, {
        servicedAt: d === today() ? undefined : new Date(`${d}T12:00:00`).toISOString(),
        odometerKm: num(f.get("odometerKm")),
        note: String(f.get("note") ?? "").trim() || null
      });
      setServicing(null);
      return "Service recorded; the interval starts again.";
    });
  }

  const counts = { overdue: items.filter((i) => i.status.state === "overdue").length, soon: items.filter((i) => i.status.state === "due_soon").length };
  const vehicles = [...new Set(items.map((i) => i.vehicleName))];

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Maintenance</h1>
        <nav style={{ display: "flex", gap: 12 }}>
          <a href="/vehicles">Vehicles</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>
      <p style={{ color: "#5b6470", marginTop: 0 }}>
        Distance is measured from GPS since the last service (moving only). {counts.overdue} overdue · {counts.soon} due soon.
      </p>
      {msg && (
        <p role="status" style={{ ...box, borderColor: msg.ok ? "#2a7" : "#c33" }}>
          {msg.text}
        </p>
      )}

      {items.length === 0 && <p>No reminders yet.</p>}
      {vehicles.map((vn) => (
        <section key={vn} style={box}>
          <h2 style={{ fontSize: 17, marginTop: 0 }}>{vn}</h2>
          {items
            .filter((i) => i.vehicleName === vn)
            .map((i) => {
              const b = BADGE[i.status.state]!;
              return (
                <div key={i.id} style={{ borderTop: "1px solid #f0f2f4", padding: "10px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ background: b.bg, color: b.fg, borderRadius: 999, padding: "2px 10px", fontSize: 13, fontWeight: 600 }}>{b.text}</span>
                    <strong>{i.name}</strong>
                    <span style={{ color: "#5b6470", fontSize: 14 }}>
                      every {[i.intervalKm ? `${i.intervalKm.toLocaleString()} km` : null, i.intervalDays ? `${i.intervalDays} days` : null].filter(Boolean).join(" or ")}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>
                    {remaining(i)} · {i.status.kmSinceService} km since last service ({new Date(i.lastServiceAt).toLocaleDateString()}
                    {i.lastServiceOdometerKm !== null ? `, odometer ${i.lastServiceOdometerKm.toLocaleString()} km` : ""})
                  </div>
                  {i.note && <div style={{ fontSize: 13, color: "#5b6470" }}>{i.note}</div>}
                  {i.history.length > 0 && (
                    <details style={{ fontSize: 13, marginTop: 4 }}>
                      <summary>Service history</summary>
                      <ul style={{ margin: "4px 0" }}>
                        {i.history.map((h) => (
                          <li key={h.servicedAt}>
                            {new Date(h.servicedAt).toLocaleDateString()}
                            {h.kmSincePrevious !== null ? ` · ${h.kmSincePrevious} km since previous` : ""}
                            {h.odometerKm !== null ? ` · odometer ${h.odometerKm.toLocaleString()}` : ""}
                            {h.note ? ` · ${h.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {props.canWrite &&
                    (servicing === i.id ? (
                      <form method="post" onSubmit={(e) => onService(e, i.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "end" }}>
                        <label style={{ fontSize: 13 }}>
                          Date
                          <br />
                          <input type="date" name="servicedAt" defaultValue={today()} max={today()} required style={input} />
                        </label>
                        <label style={{ fontSize: 13 }}>
                          Odometer (optional)
                          <br />
                          <input type="number" name="odometerKm" min={0} style={{ ...input, width: 130 }} />
                        </label>
                        <label style={{ fontSize: 13, flex: 1, minWidth: 160 }}>
                          Note
                          <br />
                          <input name="note" maxLength={500} style={{ ...input, width: "100%" }} />
                        </label>
                        <button type="submit" disabled={busy}>Save</button>
                        <button type="button" onClick={() => setServicing(null)}>Cancel</button>
                      </form>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button disabled={busy} onClick={() => setServicing(i.id)}>Mark serviced</button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Delete "${i.name}" for ${i.vehicleName}? Its service history is deleted too.`)) void run(async () => (await call("DELETE", `/api/maintenance/${i.id}`), "Deleted."));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
        </section>
      ))}

      {props.canWrite && (
        <form method="post" onSubmit={onCreate} style={box} key={preset?.name ?? "custom"}>
          <h2 style={{ fontSize: 17, marginTop: 0 }}>Add reminder</h2>
          {props.vehicles.length === 0 ? (
            <p>Add a vehicle first.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {PRESETS.map((p) => (
                  <button type="button" key={p.name} onClick={() => setPreset(p)} style={{ fontWeight: preset?.name === p.name ? 700 : 400 }}>
                    {p.name}
                  </button>
                ))}
                <button type="button" onClick={() => setPreset(null)} style={{ fontWeight: preset === null ? 700 : 400 }}>
                  Custom
                </button>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label>
                  Vehicle
                  <br />
                  <select name="vehicleId" required style={{ ...input, width: "100%" }}>
                    {props.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  What
                  <br />
                  <input name="name" required maxLength={120} defaultValue={preset?.name ?? ""} style={{ ...input, width: "100%" }} />
                </label>
                <label>
                  Every … km
                  <br />
                  <input type="number" name="intervalKm" min={1} defaultValue={preset?.km ?? ""} style={{ ...input, width: "100%" }} />
                </label>
                <label>
                  and/or every … days
                  <br />
                  <input type="number" name="intervalDays" min={1} max={3650} defaultValue={preset?.days ?? ""} style={{ ...input, width: "100%" }} />
                </label>
                <label>
                  Last service date
                  <br />
                  <input type="date" name="lastServiceAt" required defaultValue={today()} max={today()} style={{ ...input, width: "100%" }} />
                </label>
                <label>
                  Odometer then (optional)
                  <br />
                  <input type="number" name="odometer" min={0} style={{ ...input, width: "100%" }} />
                </label>
              </div>
              <fieldset style={{ border: "none", padding: 0, marginTop: 10 }}>
                <legend>Email when due soon / overdue</legend>
                {props.members.map((m) => (
                  <label key={m.id} style={{ display: "block" }}>
                    <input type="checkbox" name="notify" value={m.id} defaultChecked={m.id === props.myUserId} /> {m.label}
                  </label>
                ))}
              </fieldset>
              <label style={{ display: "block", marginTop: 8 }}>
                Note (optional)
                <br />
                <input name="note" maxLength={500} style={{ ...input, width: "100%" }} />
              </label>
              <button type="submit" disabled={busy} style={{ marginTop: 10 }}>
                Add reminder
              </button>
            </>
          )}
        </form>
      )}
    </main>
  );
}
