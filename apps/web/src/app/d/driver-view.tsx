"use client";
/**
 * The driver's page. Asks for consent, then sends the phone's location while this page is open:
 * on the first fix, then every couple of minutes, plus whenever the page comes back into view.
 * Positions taken while offline wait on the phone (this browser only) and go out together later.
 * The driver can stop at any time; the page stops by itself when the load ends.
 *
 * A web page cannot track in the background: if the phone locks or the page closes, sending
 * pauses until it is opened again. The page says so, and keeps the screen on when allowed.
 */
import { dateFormatter } from "@rio-gps/core/timezones";
import { ArrowDown, CheckCircle2, Loader2, MapPin, PauseCircle, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DriverView as View, PingResult } from "@/lib/load-public";
import { LOAD_STATUS_META, shortPlace } from "@/lib/load-meta";

type Pos = { latitude: number; longitude: number; accuracyM: number | null; speedKph: number | null; headingDeg: number | null; recordedAt: string };
type State = { kind: "loading" } | { kind: "gone" } | { kind: "error"; message: string } | { kind: "ok"; view: View };

const QUEUE_MAX = 100;
const queueKey = (token: string) => `rio-driver-queue:${token.slice(0, 10)}`;
const readQueue = (token: string): Pos[] => {
  try {
    return JSON.parse(localStorage.getItem(queueKey(token)) ?? "[]") as Pos[];
  } catch {
    return [];
  }
};
const writeQueue = (token: string, q: Pos[]) => {
  try {
    if (q.length) localStorage.setItem(queueKey(token), JSON.stringify(q.slice(-QUEUE_MAX)));
    else localStorage.removeItem(queueKey(token));
  } catch {
    // storage unavailable (private mode): positions just are not kept across reloads
  }
};

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T | null; message?: string }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer" });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  return { status: res.status, data: res.ok ? json : null, message: json?.error?.message };
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-canvas px-4 py-6">
      <div className="mb-5 flex items-center gap-2 text-base font-semibold text-foreground">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">
          R
        </span>
        RIO GPS
      </div>
      <div className={`w-full ${wide ? "max-w-md" : "max-w-sm"} rounded-xl border border-border bg-background p-5 shadow-card`}>{children}</div>
    </main>
  );
}

export function DriverView() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [lastFix, setLastFix] = useState<Pos | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sendError, setSendError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const latest = useRef<Pos | null>(null);
  const lastQueuedAt = useRef(0);
  const sending = useRef(false);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const view = state.kind === "ok" ? state.view : null;
  const sharing = view?.phase === "sharing";
  const intervalMs = (view?.pingIntervalSeconds ?? 120) * 1000;

  // Read the token from the fragment and load the view.
  useEffect(() => {
    const t = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) {
      setState({ kind: "gone" });
      return;
    }
    setToken(t);
    post<View>("/api/driver/view", { token: t })
      .then((r) => setState(r.status === 404 ? { kind: "gone" } : r.data ? { kind: "ok", view: r.data } : { kind: "error", message: r.message ?? "Could not load this page. Check your connection and try again." }))
      .catch(() => setState({ kind: "error", message: "Could not load this page. Check your connection and try again." }));
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  /** Sends queued positions plus the newest one. Keeps them queued if the network fails. */
  const flush = useCallback(async () => {
    if (!token || sending.current) return;
    const queue = readQueue(token);
    if (latest.current && latest.current.recordedAt !== queue.at(-1)?.recordedAt) queue.push(latest.current);
    if (!queue.length) return;
    sending.current = true;
    writeQueue(token, queue);
    try {
      const r = await post<PingResult>("/api/driver/positions", { token, positions: queue.slice(-QUEUE_MAX), source: "web" });
      if (r.status === 404) {
        writeQueue(token, []);
        setState({ kind: "gone" });
        return;
      }
      if (!r.data) throw new Error(r.message ?? "send failed");
      writeQueue(token, []);
      setLastSentAt(Date.now());
      setSendError(null);
      const d = r.data;
      setState((s) => (s.kind === "ok" ? { kind: "ok", view: { ...s.view, status: d.status, phase: d.phase } } : s));
    } catch {
      setSendError("No connection. Your locations are saved on this phone and will be sent when you're back online.");
    } finally {
      sending.current = false;
    }
  }, [token]);

  // While sharing: watch the location, send on the first fix and then on a timer.
  useEffect(() => {
    if (!sharing || !token) return;
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share location. Open the link in Chrome or Safari.");
      return;
    }
    let first = true;
    const toPos = (p: GeolocationPosition): Pos => ({
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracyM: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
      speedKph: p.coords.speed !== null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6) : null,
      headingDeg: p.coords.heading !== null && p.coords.heading >= 0 && p.coords.heading <= 360 ? Math.round(p.coords.heading) : null,
      recordedAt: new Date(p.timestamp || Date.now()).toISOString()
    });
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = toPos(p);
        latest.current = pos;
        setLastFix(pos);
        setGeoError(null);
        // Keep one position per interval in the offline queue, so a gap still leaves a trail.
        if (Date.now() - lastQueuedAt.current >= intervalMs) {
          lastQueuedAt.current = Date.now();
          writeQueue(token, [...readQueue(token), pos]);
        }
        if (first) {
          first = false;
          void flush();
        }
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this page. Allow location for this site in your browser settings, then reload the page."
            : "Can't get your location right now. Make sure location (GPS) is turned on."
        );
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 }
    );
    // A parked phone may not report new fixes on its own: ask for a fresh one each interval,
    // so the broker sees "at pickup, 2 min ago" rather than a stale position.
    const timer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          latest.current = toPos(p);
          setLastFix(latest.current);
          void flush();
        },
        () => void flush(),
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 }
      );
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [sharing, token, intervalMs, flush]);

  // Keep the screen on while sharing (where the browser allows it).
  useEffect(() => {
    if (!sharing) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => {
      if (document.visibilityState === "visible" && nav.wakeLock && !wakeLock.current) {
        nav.wakeLock
          .request("screen")
          .then((l) => {
            wakeLock.current = l;
          })
          .catch(() => undefined);
      }
    };
    acquire();
    const onVis = () => {
      wakeLock.current = null;
      acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    };
  }, [sharing]);

  async function act(action: "accept" | "decline" | "stop") {
    if (!token) return;
    setBusy(true);
    try {
      if (action === "accept") {
        // Ask for location first, so declining the browser prompt doesn't count as consent.
        const ok = await new Promise<boolean>((resolve) => {
          if (!("geolocation" in navigator)) return resolve(false);
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            (err) => resolve(err.code !== err.PERMISSION_DENIED),
            { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 }
          );
        });
        if (!ok) {
          setGeoError("Location is blocked for this page. Allow location for this site in your browser settings, then tap Share again.");
          return;
        }
      }
      if (action === "stop") await flush();
      const r = await post<View>("/api/driver/action", { token, action });
      if (r.status === 404) return setState({ kind: "gone" });
      if (r.data) setState({ kind: "ok", view: r.data });
      else setGeoError(r.message ?? "Something went wrong. Try again.");
    } catch {
      setGeoError("No connection. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <Shell>
        <p className="m-0 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      </Shell>
    );
  }
  if (state.kind === "gone") {
    return (
      <Shell>
        <h1 className="m-0 text-lg font-semibold">This link is not available</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground">It may have been replaced by a newer link. Ask the broker who sent it for a new one.</p>
      </Shell>
    );
  }
  if (state.kind === "error") {
    return (
      <Shell>
        <h1 className="m-0 text-lg font-semibold">Could not load this page</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground" role="alert">
          {state.message}
        </p>
        <Button className="mt-4 w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Shell>
    );
  }

  const v = state.view;
  const f = dateFormatter(v.timeZone, v.timeFormat);
  const lane = (
    <ol className="m-0 grid list-none gap-1 rounded-lg bg-muted p-3 text-sm">
      <li className="flex gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[#0e7c66]" aria-hidden="true" />
        <span>
          <span className="font-medium">Pickup:</span> {shortPlace(v.pickup.name, v.pickup.address)}
          {v.pickup.appointmentAt && <span className="block text-xs text-muted-foreground">{f.dateTime(v.pickup.appointmentAt)} {f.abbr(v.pickup.appointmentAt)}</span>}
        </span>
      </li>
      <li aria-hidden="true" className="pl-0.5 text-muted-foreground">
        <ArrowDown className="size-3.5" />
      </li>
      <li className="flex gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[#d81e2c]" aria-hidden="true" />
        <span>
          <span className="font-medium">Delivery:</span> {shortPlace(v.delivery.name, v.delivery.address)}
          {v.delivery.appointmentAt && <span className="block text-xs text-muted-foreground">{f.dateTime(v.delivery.appointmentAt)} {f.abbr(v.delivery.appointmentAt)}</span>}
        </span>
      </li>
    </ol>
  );
  const geo = geoError && (
    <p role="alert" className="m-0 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
      {geoError}
    </p>
  );

  if (v.phase === "ended") {
    return (
      <Shell wide>
        <div className="grid justify-items-center gap-2 text-center">
          {v.status === "declined" ? <XCircle className="size-10 text-muted-foreground" aria-hidden="true" /> : <CheckCircle2 className="size-10 text-success" aria-hidden="true" />}
          <h1 className="m-0 text-lg font-semibold">{v.status === "declined" ? "You declined this load" : v.status === "cancelled" ? "This load was cancelled" : "Load complete"}</h1>
          <p className="m-0 text-sm text-muted-foreground">Location sharing for load {v.reference} has stopped. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  if (v.phase === "invite") {
    return (
      <Shell wide>
        <div className="grid gap-4">
          <div>
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Location request</p>
            <h1 className="m-0 mt-1 text-xl font-semibold leading-7">
              {v.organizationName} asks you to share your location for load {v.reference}
            </h1>
          </div>
          {lane}
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              Only for this load: sharing stops by itself when it is delivered.
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {v.organizationName} sees where the truck is, so they don&apos;t need to call you for updates.
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              You can stop sharing at any time on this page.
            </li>
          </ul>
          {geo}
          <Button size="lg" className="w-full" loading={busy} onClick={() => void act("accept")}>
            <MapPin aria-hidden="true" /> Share my location
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void act("decline")}>
            Decline
          </Button>
          <p className="m-0 text-center text-xs text-muted-foreground">Your phone will ask to allow location. Tap Allow.</p>
        </div>
      </Shell>
    );
  }

  if (v.phase === "paused") {
    return (
      <Shell wide>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <PauseCircle className="size-6 text-warning" aria-hidden="true" />
            <h1 className="m-0 text-lg font-semibold">Sharing is paused</h1>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            {v.organizationName} can&apos;t see your location for load {v.reference} until you resume.
          </p>
          {lane}
          {geo}
          <Button size="lg" className="w-full" loading={busy} onClick={() => void act("accept")}>
            <MapPin aria-hidden="true" /> Resume sharing
          </Button>
        </div>
      </Shell>
    );
  }

  // Sharing.
  const status = LOAD_STATUS_META[v.status];
  return (
    <Shell wide>
      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          <span className="relative mt-1 flex size-3 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-success" />
          </span>
          <div>
            <h1 className="m-0 text-lg font-semibold leading-6">Sharing your location</h1>
            <p className="m-0 text-sm text-muted-foreground">
              Load {v.reference} for {v.organizationName} · {status.label}
            </p>
          </div>
        </div>
        {lane}
        <div className="rounded-lg border border-border p-3 text-sm" aria-live="polite">
          {lastSentAt ? (
            <p className="m-0">
              Last sent <span className="font-medium">{ago(now - lastSentAt)}</span>
              {lastFix?.accuracyM != null && <span className="text-muted-foreground"> · accurate to about {lastFix.accuracyM} m</span>}
            </p>
          ) : (
            <p className="m-0 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Finding your location…
            </p>
          )}
          {sendError && <p className="m-0 mt-1 text-warning">{sendError}</p>}
        </div>
        {geo}
        <p className="m-0 rounded-lg bg-info-soft p-3 text-sm text-foreground">
          <span className="font-medium">Keep this page open.</span> Your location is sent while this page is on screen. If you close it or lock the phone, open your link again to continue.
        </p>
        <Button variant="danger-outline" className="w-full" loading={busy} onClick={() => void act("stop")}>
          Stop sharing
        </Button>
      </div>
    </Shell>
  );
}
