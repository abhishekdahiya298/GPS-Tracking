"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { AlertEventDto, AlertRuleDto } from "@/lib/alerts";

type Ref = { id: string; name: string };
const TYPE_LABEL: Record<string, string> = {
  geofence_enter: "Enters zone",
  geofence_exit: "Leaves zone",
  speeding: "Speeding",
  ignition_on: "Ignition on",
  ignition_off: "Ignition off",
  device_offline: "Device offline"
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (res.status === 401) {
    window.location.assign("/login?next=/alerts");
    throw new Error("Signed out");
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body;
}

function describe(e: AlertEventDto) {
  const who = e.vehicleName ?? "Device";
  const d = e.details ?? {};
  switch (e.type) {
    case "geofence_enter":
      return `${who} entered ${String(d.geofence ?? "a zone")}`;
    case "geofence_exit":
      return `${who} left ${String(d.geofence ?? "a zone")}`;
    case "speeding":
      return `${who} at ${String(d.speedKph)} km/h (limit ${String(d.limitKph)})`;
    case "ignition_on":
      return `${who} ignition on`;
    case "ignition_off":
      return `${who} ignition off`;
    case "device_offline":
      return `${who} offline (no data for ${String(d.offlineMinutes)} min)`;
  }
}

const box = { border: "1px solid #e3e6ea", borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const inp = { padding: 8, fontSize: 15, minWidth: 0, boxSizing: "border-box" } as const;

export function AlertsManager(props: {
  initialEvents: AlertEventDto[];
  initialUnack: number;
  initialRules: AlertRuleDto[];
  geofences: Ref[];
  vehicles: Ref[];
  canWrite: boolean;
}) {
  const { geofences, vehicles, canWrite } = props;
  const [events, setEvents] = useState(props.initialEvents);
  const [unack, setUnack] = useState(props.initialUnack);
  const [rules, setRules] = useState(props.initialRules);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<string>("geofence_enter");
  const [more, setMore] = useState(props.initialEvents.length === 50);

  // Live: new alerts arrive over the same authenticated SSE stream as locations.
  useEffect(() => {
    const es = new EventSource("/api/locations/stream");
    es.addEventListener("alert", (ev) => {
      const a = JSON.parse((ev as MessageEvent).data) as AlertEventDto;
      setEvents((list) => (list.some((x) => x.id === a.id) ? list : [a, ...list]));
      setUnack((n) => n + 1);
    });
    return () => es.close();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const reloadRules = async () => setRules((await api("/api/alert-rules")).rules);
  const ack = (ids: number[] | "all") =>
    run(async () => {
      await api("/api/alerts/acknowledge", { method: "POST", body: JSON.stringify(ids === "all" ? { all: true } : { ids }) });
      const now = new Date().toISOString();
      setEvents((list) => list.map((e) => (ids === "all" || ids.includes(e.id) ? { ...e, acknowledgedAt: e.acknowledgedAt ?? now } : e)));
      setUnack(ids === "all" ? 0 : (n) => Math.max(0, n - ids.length));
    });

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    await run(async () => {
      await api("/api/alert-rules", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          type,
          vehicleId: f.get("vehicleId") || null,
          geofenceId: f.get("geofenceId") || null,
          speedKph: num("speedKph"),
          offlineMinutes: num("offlineMinutes"),
          notifyEmail: f.get("notifyEmail") === "on"
        })
      });
      form.reset();
      await reloadRules();
    });
  }

  const ruleSummary = (r: AlertRuleDto) => {
    const target = r.vehicleId ? (vehicles.find((v) => v.id === r.vehicleId)?.name ?? "vehicle") : "all vehicles";
    const extra =
      r.type === "speeding"
        ? ` > ${r.speedKph} km/h`
        : r.type === "device_offline"
          ? ` for ${r.offlineMinutes} min`
          : r.geofenceId
            ? `: ${geofences.find((g) => g.id === r.geofenceId)?.name ?? "zone"}`
            : "";
    return `${TYPE_LABEL[r.type]}${extra} · ${target}${r.notifyEmail ? " · email" : ""}`;
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Alerts {unack > 0 && <span style={{ fontSize: 14, background: "#c0392b", color: "#fff", borderRadius: 10, padding: "2px 8px" }}>{unack} new</span>}</h1>
      </header>
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      <section style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Recent alerts</h2>
          {canWrite && unack > 0 && (
            <button type="button" disabled={busy} onClick={() => ack("all")}>
              Acknowledge all
            </button>
          )}
        </div>
        {events.length === 0 && <p style={{ color: "#5b6470" }}>No alerts yet.</p>}
        {events.map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f0f2f4", opacity: e.acknowledgedAt ? 0.6 : 1 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.acknowledgedAt ? "#b0b6be" : "#c0392b", flex: "none" }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>{describe(e)}</strong>
              <div style={{ fontSize: 12, color: "#5b6470" }}>
                {new Date(e.occurredAt).toLocaleString()} · {e.ruleName}
                {e.latitude !== null && e.longitude !== null && (
                  <>
                    {" · "}
                    <a href={`https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=16/${e.latitude}/${e.longitude}`} target="_blank" rel="noopener noreferrer">
                      location
                    </a>
                  </>
                )}
              </div>
            </div>
            {canWrite && !e.acknowledgedAt && (
              <button type="button" disabled={busy} onClick={() => ack([e.id])}>
                Acknowledge
              </button>
            )}
          </div>
        ))}
        {more && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const last = events[events.length - 1];
                const b = await api(`/api/alerts?limit=50${last ? `&beforeId=${last.id}` : ""}`);
                setEvents((list) => [...list, ...b.events]);
                setMore(b.events.length === 50);
              })
            }
          >
            Load older
          </button>
        )}
      </section>

      <section style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Rules</h2>
        {rules.length === 0 && <p style={{ color: "#5b6470" }}>No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f0f2f4", opacity: r.active ? 1 : 0.55 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>{r.name}</strong>
              <div style={{ fontSize: 12, color: "#5b6470" }}>{ruleSummary(r)}</div>
            </div>
            {canWrite && (
              <>
                <button type="button" disabled={busy} onClick={() => run(async () => { await api(`/api/alert-rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: !r.active }) }); await reloadRules(); })}>
                  {r.active ? "Pause" : "Resume"}
                </button>
                <button type="button" disabled={busy} onClick={() => run(async () => { await api(`/api/alert-rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ notifyEmail: !r.notifyEmail }) }); await reloadRules(); })}>
                  {r.notifyEmail ? "Email off" : "Email on"}
                </button>
                <button type="button" disabled={busy} onClick={() => window.confirm(`Delete rule "${r.name}"?`) && run(async () => { await api(`/api/alert-rules/${r.id}`, { method: "DELETE" }); await reloadRules(); })}>
                  Delete
                </button>
              </>
            )}
          </div>
        ))}

        {canWrite && (
          <form method="post" onSubmit={onCreate} style={{ display: "grid", gap: 8, marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <input name="name" required maxLength={120} placeholder="Rule name" aria-label="Rule name" style={inp} />
            <select aria-label="Alert type" value={type} onChange={(e) => setType(e.target.value)} style={inp}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {(type === "geofence_enter" || type === "geofence_exit") && (
              <select name="geofenceId" required aria-label="Zone" style={inp} defaultValue="">
                <option value="" disabled>
                  {geofences.length ? "Choose a zone" : "Create a zone first"}
                </option>
                {geofences.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            {type === "speeding" && <input name="speedKph" type="number" required min={5} max={300} placeholder="Limit km/h" aria-label="Speed limit km/h" style={inp} />}
            {type === "device_offline" && <input name="offlineMinutes" type="number" required min={5} max={10080} defaultValue={90} aria-label="Offline after minutes" style={inp} />}
            <select name="vehicleId" aria-label="Vehicle" style={inp} defaultValue="">
              <option value="">All vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="notifyEmail" /> Email admins &amp; dispatchers
            </label>
            <button type="submit" disabled={busy}>
              Add rule
            </button>
          </form>
        )}
        {type === "device_offline" && canWrite && (
          <p style={{ fontSize: 12, color: "#5b6470" }}>Tip: a parked FTM880 reports about hourly, so use at least 90 minutes to avoid false alarms.</p>
        )}
      </section>
    </main>
  );
}
