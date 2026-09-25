"use client";

import { useState, type FormEvent } from "react";
import type { ScheduleDto } from "@/lib/report-schedules";

type Opt = { id: string; label: string };
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const box = { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

export function SchedulesManager(props: { initial: ScheduleDto[]; members: Opt[]; devices: Opt[]; myUserId: string; emailEnabled: boolean }) {
  const [items, setItems] = useState(props.initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [freq, setFreq] = useState<"daily" | "weekly">("daily");
  const [allDevices, setAllDevices] = useState(true);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const name = (list: Opt[], id: string) => list.find((o) => o.id === id)?.label.replace(/ <.*>$/, "") ?? "(removed)";

  async function refresh() {
    const res = await fetch("/api/report-schedules", { cache: "no-store" });
    if (res.ok) setItems((await res.json()).schedules);
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const recipients = f.getAll("recipient").map(String);
    const devices = f.getAll("device").map(String);
    if (recipients.length === 0) return setMsg({ ok: false, text: "Choose at least one recipient" });
    if (!allDevices && devices.length === 0) return setMsg({ ok: false, text: "Choose at least one vehicle, or All vehicles" });
    void run(async () => {
      await call("POST", "/api/report-schedules", {
        name: f.get("name"),
        frequency: freq,
        timeZone: f.get("timeZone"),
        sendHour: Number(f.get("sendHour")),
        weekday: Number(f.get("weekday") ?? 1),
        deviceIds: allDevices ? null : devices,
        recipientUserIds: recipients,
        attachCsv: f.get("attachCsv") === "on"
      });
      form.reset();
      setAllDevices(true);
      return "Schedule saved. The first email goes out at the next scheduled time.";
    });
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Report emails</h1>
      </header>
      <p style={{ color: "#555", marginTop: 0 }}>Trip summaries (trips, distance, driving time, top speed per vehicle) emailed automatically for the previous day or week.</p>
      {!props.emailEnabled && <p style={{ ...box, borderColor: "#c33" }}>Email is not configured on this server, so schedules will not send.</p>}
      {msg && (
        <p role="status" style={{ ...box, borderColor: msg.ok ? "#2a7" : "#c33" }}>
          {msg.text}
        </p>
      )}

      {items.length === 0 ? (
        <p>No schedules yet.</p>
      ) : (
        items.map((s) => (
          <section key={s.id} style={{ ...box, opacity: s.active ? 1 : 0.6 }}>
            <strong>{s.name}</strong> {!s.active && <em>(paused)</em>}
            <div style={{ fontSize: 14, marginTop: 4 }}>
              {s.frequency === "daily" ? `Every day at ${hour(s.sendHour)}` : `Every ${DAYS[s.weekday]} at ${hour(s.sendHour)}`} ({s.timeZone}) ·{" "}
              {s.deviceIds ? s.deviceIds.map((id) => name(props.devices, id)).join(", ") : "All vehicles"} · to {s.recipientUserIds.map((id) => name(props.members, id)).join(", ")}
              {s.attachCsv ? " · CSV attached" : ""}
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
              {s.lastSentAt ? `Last sent ${new Date(s.lastSentAt).toLocaleString()} (${s.lastStatus ?? ""})` : s.lastStatus ? `Last status: ${s.lastStatus}` : "Not sent yet"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button disabled={busy || !props.emailEnabled} onClick={() => run(async () => `Test for ${(await call("POST", `/api/report-schedules/${s.id}/test`)).period} sent to your email.`)}>
                Send me a test
              </button>
              <button disabled={busy} onClick={() => run(async () => (await call("PATCH", `/api/report-schedules/${s.id}`, { active: !s.active }), s.active ? "Paused." : "Resumed."))}>
                {s.active ? "Pause" : "Resume"}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${s.name}"?`)) void run(async () => (await call("DELETE", `/api/report-schedules/${s.id}`), "Deleted."));
                }}
              >
                Delete
              </button>
            </div>
          </section>
        ))
      )}

      <form method="post" onSubmit={onCreate} style={box}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>New schedule</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label>
            Name
            <br />
            <input name="name" required maxLength={120} defaultValue="Daily fleet summary" />
          </label>
          <label>
            How often
            <br />
            <select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value as "daily" | "weekly")}>
              <option value="daily">Daily (previous day)</option>
              <option value="weekly">Weekly (previous Mon–Sun)</option>
            </select>
          </label>
          {freq === "weekly" && (
            <label>
              Send on
              <br />
              <select name="weekday" defaultValue="1">
                {DAYS.slice(1).map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Send at
            <br />
            <select name="sendHour" defaultValue="7">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time zone
            <br />
            <input name="timeZone" required defaultValue={browserTz} maxLength={64} />
          </label>
        </div>
        <fieldset style={{ marginTop: 12, border: "none", padding: 0 }}>
          <legend>Vehicles</legend>
          <label>
            <input type="checkbox" checked={allDevices} onChange={(e) => setAllDevices(e.target.checked)} /> All vehicles (including ones added later)
          </label>
          {!allDevices &&
            props.devices.map((d) => (
              <label key={d.id} style={{ display: "block" }}>
                <input type="checkbox" name="device" value={d.id} /> {d.label}
              </label>
            ))}
        </fieldset>
        <fieldset style={{ marginTop: 12, border: "none", padding: 0 }}>
          <legend>Recipients (team members)</legend>
          {props.members.map((m) => (
            <label key={m.id} style={{ display: "block" }}>
              <input type="checkbox" name="recipient" value={m.id} defaultChecked={m.id === props.myUserId} /> {m.label}
            </label>
          ))}
        </fieldset>
        <label style={{ display: "block", marginTop: 12 }}>
          <input type="checkbox" name="attachCsv" defaultChecked /> Attach a CSV of every trip
        </label>
        <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
          Save schedule
        </button>
      </form>
    </main>
  );
}
