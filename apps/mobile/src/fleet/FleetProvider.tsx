import { units, type Units, type UnitSystem } from "@rio-gps/core/units";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, api, buildUrl, tokenStore } from "../api";
import { API_BASE_URL } from "../config";
import { APP_PLATFORM, APP_VERSION } from "../updates/events";
import { loadFleetCache, saveFleetCache } from "./cache";
import type { CurrentLocationsResponse, FleetDevice } from "./model";
import { applyLocation, backoffMs, mergeSnapshot, parseJson, type LiveLocationEvent } from "./sse";
import { openStream } from "./stream";

/** How often the fleet is re-read while the live stream is not connected. */
const REFRESH_MS = 20_000;
/** With the stream connected, a slow full re-read still runs: it catches trackers going offline or being added. */
const LIVE_REFRESH_MS = 60_000;
/** Live positions are collected and shown at most this often, so a burst never redraws per event. */
const FLUSH_MS = 1000;

/** live: positions arrive as they happen. polling: re-read every 20 s (stream not connected). */
export type Connection = "connecting" | "live" | "polling";

interface FleetValue {
  devices: FleetDevice[];
  /** True until the first answer (or first error) arrives. */
  loading: boolean;
  /** Set when the latest refresh failed; the last good list stays on screen. */
  error: string | null;
  updatedAt: number | null;
  connection: Connection;
  units: Units;
  /** The organization's time zone and clock style, used for trip days and times. */
  timeZone: string;
  timeFormat: "12h" | "24h";
  refresh(): Promise<void>;
  /** Called when the live stream reports a new alert. Returns a function that stops listening. */
  onLiveAlert(listener: () => void): () => void;
}

const FleetContext = createContext<FleetValue | null>(null);

/** One shared copy of the fleet for the list, the detail screen and the map. */
export function FleetProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [system, setSystem] = useState<UnitSystem>("imperial");
  const [timeZone, setTimeZone] = useState("America/Toronto");
  const [timeFormat, setTimeFormat] = useState<"12h" | "24h">("12h");
  const inFlight = useRef<Promise<void> | null>(null);
  // The truth between redraws: live positions land here first and reach the screen once a second.
  const fleet = useRef(new Map<string, FleetDevice>());
  const alertListeners = useRef(new Set<() => void>());

  const savedAt = useRef(0);
  const show = useCallback(() => {
    const list = [...fleet.current.values()];
    setDevices(list);
    setUpdatedAt(Date.now());
    // Keep a copy on the phone (at most every 30 s) for the next app start.
    if (Date.now() - savedAt.current > 30_000) {
      savedAt.current = Date.now();
      saveFleetCache(list);
    }
  }, []);

  // App start: show the fleet as it was last time, until the server answers.
  useEffect(() => {
    let cancelled = false;
    void loadFleetCache().then((saved) => {
      if (cancelled || !saved || fleet.current.size > 0) return;
      fleet.current = new Map(saved.devices.map((d) => [d.deviceId, d]));
      setDevices(saved.devices);
      setUpdatedAt(saved.savedAt);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const data = await api.get<CurrentLocationsResponse>("locations/current");
        fleet.current = mergeSnapshot(fleet.current, Array.isArray(data.devices) ? data.devices : []);
        show();
        setError(null);
      } catch (e) {
        // A 401 signs the person out elsewhere; nothing to show here.
        if (!(e instanceof ApiError && e.kind === "unauthorized")) {
          setError(e instanceof ApiError && e.kind === "forbidden" ? "Your account can't view vehicle locations." : e instanceof ApiError ? e.message : "Something went wrong.");
        }
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [show]);

  // Display units follow the organization's setting, as on the website.
  useEffect(() => {
    api
      .get<{ unitSystem?: string; timeZone?: string; timeFormat?: string }>("organization")
      .then((org) => {
        if (org.unitSystem === "metric" || org.unitSystem === "imperial") setSystem(org.unitSystem);
        if (typeof org.timeZone === "string" && org.timeZone) setTimeZone(org.timeZone);
        if (org.timeFormat === "12h" || org.timeFormat === "24h") setTimeFormat(org.timeFormat);
      })
      .catch(() => undefined);
  }, []);

  /**
   * While the app is in front: read the fleet, then keep it fresh. The live stream is the fast
   * path (the same one the website uses); the timed re-read is the safety net, so if the stream
   * can't connect the app simply behaves as before.
   */
  useEffect(() => {
    let active = false;
    let closeStream: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let flush: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let dirty = false;

    const setPoll = (ms: number) => {
      if (poll) clearInterval(poll);
      poll = setInterval(() => void refresh(), ms);
    };

    const connect = async () => {
      if (!active) return;
      const token = await tokenStore.get().catch(() => null);
      if (!active || !token) return;
      closeStream?.();
      closeStream = openStream({
        url: buildUrl(API_BASE_URL, "locations/stream"),
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}`, "X-RIO-App-Version": APP_VERSION, "X-RIO-App-Platform": APP_PLATFORM },
        onOpen: () => undefined,
        onEvent: (e) => {
          if (e.event === "snapshot") {
            const snap = parseJson<{ devices?: FleetDevice[] }>(e.data);
            if (!snap || !Array.isArray(snap.devices)) return;
            attempt = 0;
            fleet.current = mergeSnapshot(fleet.current, snap.devices);
            show();
            setError(null);
            setLoading(false);
            setConnection("live");
            setPoll(LIVE_REFRESH_MS);
          } else if (e.event === "location") {
            const event = parseJson<LiveLocationEvent>(e.data);
            const updated = event ? applyLocation(fleet.current, event) : null;
            if (updated) {
              fleet.current.set(updated.deviceId, updated);
              dirty = true;
            }
          } else if (e.event === "alert") {
            alertListeners.current.forEach((l) => l());
          } else if (e.event === "end") {
            // "session_ended": the next normal request gets a 401 and signs the person out.
            void refresh();
          }
        },
        onClose: ({ planned }) => {
          closeStream = null;
          if (!active) return;
          if (!planned) {
            setConnection("polling");
            setPoll(REFRESH_MS);
            attempt++;
          }
          retry = setTimeout(() => void connect(), planned ? 0 : backoffMs(attempt));
        }
      });
    };

    const start = () => {
      if (active) return;
      active = true;
      attempt = 0;
      void refresh();
      setPoll(REFRESH_MS);
      flush = setInterval(() => {
        if (!dirty) return;
        dirty = false;
        show();
      }, FLUSH_MS);
      void connect();
    };
    const stop = () => {
      active = false;
      closeStream?.();
      closeStream = null;
      if (poll) clearInterval(poll);
      if (flush) clearInterval(flush);
      if (retry) clearTimeout(retry);
      poll = flush = retry = null;
      setConnection("connecting");
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [refresh, show]);

  const onLiveAlert = useCallback((listener: () => void) => {
    alertListeners.current.add(listener);
    return () => void alertListeners.current.delete(listener);
  }, []);

  const value = useMemo<FleetValue>(
    () => ({ devices, loading, error, updatedAt, connection, units: units(system), timeZone, timeFormat, refresh, onLiveAlert }),
    [devices, loading, error, updatedAt, connection, system, timeZone, timeFormat, refresh, onLiveAlert]
  );
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetValue {
  const value = useContext(FleetContext);
  if (!value) throw new Error("useFleet must be used inside FleetProvider");
  return value;
}

/** Re-renders on a slow tick so "5 min ago" keeps counting between refreshes. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
