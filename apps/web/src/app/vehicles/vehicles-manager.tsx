"use client";
import { useState, type FormEvent } from "react";
import type { DeviceDto, VehicleDto } from "@/lib/vehicles";

type Can = { create: boolean; update: boolean; remove: boolean; assign: boolean; unassign: boolean };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (res.status === 401) {
    window.location.assign("/login?next=/vehicles");
    throw new Error("Signed out");
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body;
}

const box = { border: "1px solid #e3e6ea", borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const input = { padding: 8, fontSize: 15, minWidth: 0, boxSizing: "border-box" } as const;

export function VehiclesManager({ initialVehicles, initialDevices, can }: { initialVehicles: VehicleDto[]; initialDevices: DeviceDto[]; can: Can }) {
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [devices, setDevices] = useState(initialDevices);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    const [v, d] = await Promise.all([api("/api/vehicles"), api("/api/devices")]);
    setVehicles(v.vehicles);
    setDevices(d.devices);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(() => api("/api/vehicles", { method: "POST", body: JSON.stringify({ name: f.get("name"), licensePlate: f.get("licensePlate") || null }) }));
    if (ok) form.reset();
  }

  async function onSave(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run(() =>
      api(`/api/vehicles/${id}`, { method: "PATCH", body: JSON.stringify({ name: f.get("name"), licensePlate: f.get("licensePlate") || null, status: f.get("status") }) })
    );
    if (ok) setEditing(null);
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 860, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Vehicles & devices</h1>
        <nav style={{ display: "flex", gap: 12 }}>
          <a href="/map">Live map</a>
          <a href="/settings/team">Team</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      <section style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Devices</h2>
        {devices.length === 0 && <p>No devices registered.</p>}
        {devices.map((d) => (
          <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f0f2f4" }}>
            <strong style={{ minWidth: 90 }}>{d.model ?? "Device"}</strong>
            <span style={{ color: "#5b6470", flex: 1, minWidth: 160 }}>
              {d.vehicle ? `on ${d.vehicle.name} since ${new Date(d.vehicle.assignedAt).toLocaleDateString()}` : "not assigned"}
            </span>
            {can.assign && vehicles.length > 0 && (
              <select
                aria-label={`Assign ${d.model ?? "device"} to vehicle`}
                value={d.vehicle?.id ?? ""}
                disabled={busy}
                onChange={(e) => e.target.value && run(() => api(`/api/devices/${d.id}/assignment`, { method: "PUT", body: JSON.stringify({ vehicleId: e.target.value }) }))}
                style={input}
              >
                <option value="">Assign to…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
            {can.unassign && d.vehicle && (
              <button type="button" disabled={busy} onClick={() => run(() => api(`/api/devices/${d.id}/assignment`, { method: "DELETE" }))}>
                Unassign
              </button>
            )}
          </div>
        ))}
        {can.assign && vehicles.length === 0 && <p style={{ color: "#5b6470" }}>Add a vehicle below, then assign a device to it.</p>}
      </section>

      <section style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Vehicles ({vehicles.length})</h2>
        {vehicles.map((v) =>
          editing === v.id ? (
            <form key={v.id} onSubmit={(e) => onSave(e, v.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f0f2f4" }}>
              <input name="name" defaultValue={v.name} required maxLength={120} style={{ ...input, flex: 2 }} aria-label="Name" />
              <input name="licensePlate" defaultValue={v.licensePlate ?? ""} maxLength={32} placeholder="Plate" style={{ ...input, flex: 1 }} aria-label="License plate" />
              <select name="status" defaultValue={v.status} style={input} aria-label="Status">
                <option value="active">active</option>
                <option value="maintenance">maintenance</option>
                <option value="inactive">inactive</option>
              </select>
              <button type="submit" disabled={busy}>
                Save
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <div key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f0f2f4" }}>
              <strong style={{ flex: 1, minWidth: 140 }}>
                {v.name} {v.licensePlate && <span style={{ fontWeight: 400, color: "#5b6470" }}>· {v.licensePlate}</span>}
              </strong>
              <span style={{ color: "#5b6470" }}>
                {v.status} · {v.devices.length ? v.devices.map((d) => d.model ?? "device").join(", ") : "no device"}
              </span>
              {can.update && (
                <button type="button" onClick={() => setEditing(v.id)} disabled={busy}>
                  Edit
                </button>
              )}
              {can.remove && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm(`Delete ${v.name}? This cannot be undone.`) && run(() => api(`/api/vehicles/${v.id}`, { method: "DELETE" }))}
                >
                  Delete
                </button>
              )}
            </div>
          )
        )}
        {can.create && (
          <form onSubmit={onCreate} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <input name="name" required maxLength={120} placeholder="Vehicle name (e.g. Range Rover)" style={{ ...input, flex: 2, minWidth: 180 }} aria-label="New vehicle name" />
            <input name="licensePlate" maxLength={32} placeholder="Plate (optional)" style={{ ...input, flex: 1, minWidth: 120 }} aria-label="New vehicle plate" />
            <button type="submit" disabled={busy}>
              Add vehicle
            </button>
          </form>
        )}
        {!can.create && vehicles.length === 0 && <p>No vehicles yet.</p>}
      </section>
    </main>
  );
}
