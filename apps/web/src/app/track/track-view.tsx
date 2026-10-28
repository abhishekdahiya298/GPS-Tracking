"use client";
/**
 * Shipper's read-only view of one load: status, ETA, appointments and the truck's last
 * position, refreshed every 30 seconds. Nothing about the driver, carrier or broker's notes.
 */
import { dateFormatter } from "@rio-gps/core/timezones";
import { useEffect, useState } from "react";
import { LoadMap } from "@/components/app/load-map";
import { StatusBadge } from "@/components/app/status-badge";
import type { ShipperView } from "@/lib/load-public";
import { LOAD_STATUS_META, shortPlace } from "@/lib/load-meta";

const POLL_MS = 30_000;
type State = { kind: "loading" } | { kind: "gone" } | { kind: "error"; message: string } | { kind: "ok"; view: ShipperView };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function TrackView() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState({ kind: "gone" });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(load, POLL_MS);
        return;
      }
      try {
        const res = await fetch("/api/track/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store", referrerPolicy: "no-referrer" });
        if (stopped) return;
        if (res.status === 404) {
          stopped = true;
          setState({ kind: "gone" });
          return;
        }
        if (!res.ok) throw new Error(res.status === 429 ? "Too many requests. Retrying shortly." : `Could not refresh (${res.status}). Retrying.`);
        const view = (await res.json()) as ShipperView;
        setState({ kind: "ok", view });
        if (view.status === "delivered" || view.status === "cancelled" || view.status === "declined") return; // final: stop polling
      } catch (err) {
        setState((s) => (s.kind === "ok" ? s : { kind: "error", message: err instanceof Error ? err.message : "Could not load this link." }));
      }
      timer = setTimeout(load, POLL_MS);
    };
    void load();
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  if (state.kind !== "ok") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-card">
          {state.kind === "loading" && (
            <p className="m-0 text-sm text-muted-foreground" role="status">
              Loading shipment…
            </p>
          )}
          {state.kind === "gone" && (
            <>
              <h1 className="m-0 text-lg font-semibold">This link is not available</h1>
              <p className="m-0 mt-2 text-sm text-muted-foreground">It may have been turned off or replaced. Ask the person who sent it for a new link.</p>
            </>
          )}
          {state.kind === "error" && (
            <>
              <h1 className="m-0 text-lg font-semibold">Could not load this shipment</h1>
              <p className="m-0 mt-2 text-sm text-muted-foreground" role="alert">
                {state.message}
              </p>
            </>
          )}
        </div>
      </main>
    );
  }

  const v = state.view;
  const f = dateFormatter(v.timeZone, v.timeFormat);
  const meta = LOAD_STATUS_META[v.status];
  const when = (iso: string) => `${f.dateTime(iso)} ${f.abbr(iso)}`;
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-border bg-background px-4 py-3">
        <p className="m-0 text-xs font-medium text-muted-foreground">Shipment tracking · {v.organizationName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-lg font-semibold">Load {v.reference}</h1>
          <StatusBadge tone={meta.tone} label={meta.shipperLabel} pulse={v.status === "in_transit"} />
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[360px] overflow-hidden rounded-xl border border-border bg-background shadow-card lg:h-[520px]">
          <LoadMap pickup={{ ...v.pickup, radiusM: 0 }} delivery={{ ...v.delivery, radiusM: 0 }} position={v.position} label={`Map of load ${v.reference}`} className="rounded-none" />
        </div>
        <div className="grid content-start gap-3">
          <section className="rounded-xl border border-border bg-background p-4 shadow-card" aria-live="polite">
            {v.deliveredAt ? (
              <p className="m-0 text-sm">
                Delivered <span className="font-medium">{when(v.deliveredAt)}</span>
              </p>
            ) : v.eta ? (
              <>
                <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">Estimated arrival at {v.eta.target}</p>
                <p className="m-0 mt-1 text-xl font-semibold tabular-nums">{when(v.eta.at)}</p>
                {v.eta.late && <p className="m-0 mt-1 text-sm font-medium text-danger">Running later than the appointment</p>}
                <p className="m-0 mt-2 text-xs text-muted-foreground">An estimate from the truck&apos;s position and average speed.</p>
              </>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">{v.status === "invited" ? "Tracking starts when the load is under way." : v.position ? meta.shipperLabel : "Waiting for the next location update."}</p>
            )}
            {v.position && <p className="m-0 mt-2 text-sm text-muted-foreground">Location updated {ago(now - Date.parse(v.position.at))}</p>}
          </section>
          {(["pickup", "delivery"] as const).map((k) => {
            const s = v[k];
            return (
              <section key={k} className="rounded-xl border border-border bg-background p-4 shadow-card">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k === "pickup" ? "Pickup" : "Delivery"}</p>
                <p className="m-0 mt-1 font-medium">{shortPlace(s.name, s.address)}</p>
                {shortPlace(s.name, s.address) !== s.address && <p className="m-0 text-sm text-muted-foreground">{s.address}</p>}
                {s.appointmentAt && <p className="m-0 mt-1 text-sm">Appointment {when(s.appointmentAt)}</p>}
              </section>
            );
          })}
        </div>
      </div>
      <footer className="px-4 py-3 text-center text-xs text-muted-foreground">Updates every 30 seconds · Powered by RIO GPS</footer>
    </div>
  );
}
