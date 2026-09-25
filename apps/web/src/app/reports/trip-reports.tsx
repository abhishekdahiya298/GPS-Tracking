"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TripReport } from "@/lib/reports";

type Dev = { id: string; label: string };

function localInput(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const cell = { padding: "6px 8px", borderTop: "1px solid #f0f2f4", whiteSpace: "nowrap" } as const;
const inp = { padding: 8, fontSize: 15, minWidth: 0, boxSizing: "border-box" } as const;

export function TripReports({ devices }: { devices: Dev[] }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [fromDay, setFromDay] = useState(() => localInput(new Date(Date.now() - 6 * 86_400_000)));
  const [toDay, setToDay] = useState(() => localInput(new Date()));
  const [report, setReport] = useState<TripReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Local calendar days → [start of fromDay, start of day after toDay) in the viewer's time zone.
  const range = useMemo(() => {
    const from = new Date(`${fromDay}T00:00:00`);
    const to = new Date(`${toDay}T00:00:00`);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [fromDay, toDay]);
  const qs = useMemo(() => new URLSearchParams({ deviceId, from: range.from, to: range.to, tz }).toString(), [deviceId, range, tz]);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/trips?${qs}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/login?next=/reports");
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setReport(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [deviceId, qs]);

  useEffect(() => {
    void load();
    // Only on first render; later loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "8px 0" }}>Trip reports</h1>
        <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/map">Live map</a>
          <a href="/alerts">Alerts</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>

      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", margin: "8px 0 16px" }}
      >
        <label style={{ display: "grid", gap: 4, flex: "2 1 220px" }}>
          Vehicle
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={inp} aria-label="Vehicle">
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, flex: "1 1 140px" }}>
          From
          <input type="date" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} style={inp} aria-label="From date" />
        </label>
        <label style={{ display: "grid", gap: 4, flex: "1 1 140px" }}>
          To
          <input type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} style={inp} aria-label="To date" />
        </label>
        <button type="submit" disabled={busy || !deviceId} style={{ padding: "9px 14px" }}>
          {busy ? "Loading…" : "Show trips"}
        </button>
        {report && report.trips.length > 0 && (
          <a href={`/api/reports/trips?${qs}&format=csv`} style={{ padding: "9px 4px" }}>
            Download CSV
          </a>
        )}
      </form>
      <p style={{ fontSize: 12, color: "#5b6470", marginTop: -8 }}>Times shown in {tz}. A trip ends after 5 minutes parked or a 20-minute data gap.</p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      {report && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              ["Trips", String(report.totals.trips)],
              ["Distance", `${report.totals.distanceKm} km`],
              ["Driving time", hm(report.totals.drivingMin)],
              ["Top speed", `${report.totals.maxSpeedKph} km/h`]
            ].map(([k, v]) => (
              <div key={k} style={{ border: "1px solid #e3e6ea", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#5b6470" }}>{k}</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </section>

          {report.days.length > 0 && (
            <section style={{ marginBottom: 16, overflowX: "auto" }}>
              <h2 style={{ fontSize: 17 }}>By day</h2>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#5b6470" }}>
                    <th style={cell}>Day</th>
                    <th style={cell}>Trips</th>
                    <th style={cell}>Distance</th>
                    <th style={cell}>Driving</th>
                    <th style={cell}>Top speed</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.day}>
                      <td style={cell}>{d.day}</td>
                      <td style={cell}>{d.trips}</td>
                      <td style={cell}>{d.distanceKm} km</td>
                      <td style={cell}>{hm(d.drivingMin)}</td>
                      <td style={cell}>{d.maxSpeedKph} km/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section style={{ overflowX: "auto" }}>
            <h2 style={{ fontSize: 17 }}>Trips</h2>
            {report.trips.length === 0 ? (
              <p style={{ color: "#5b6470" }}>No trips in this period.</p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#5b6470" }}>
                    <th style={cell}>Start</th>
                    <th style={cell}>End</th>
                    <th style={cell}>Duration</th>
                    <th style={cell}>Distance</th>
                    <th style={cell}>Max</th>
                    <th style={cell}>Avg</th>
                    <th style={cell} />
                  </tr>
                </thead>
                <tbody>
                  {report.trips.map((t) => (
                    <tr key={t.startAt}>
                      <td style={cell}>{fmt(t.startAt)}</td>
                      <td style={cell}>{fmt(t.endAt)}</td>
                      <td style={cell}>{hm(t.durationMin)}</td>
                      <td style={cell}>{t.distanceKm} km</td>
                      <td style={cell}>{t.maxSpeedKph} km/h</td>
                      <td style={cell}>{t.avgMovingKph} km/h</td>
                      <td style={cell}>
                        <a href={`/map?${new URLSearchParams({ device: report.deviceId, from: t.startAt, to: new Date(Date.parse(t.endAt) + 60_000).toISOString() })}`}>View on map</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}
