import { units, type Units, type UnitSystem } from "@rio-gps/core/units";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, api } from "../api";
import type { CurrentLocationsResponse, FleetDevice } from "./model";

/** How often the fleet is re-read while the app is open. Trackers report every 120 s when moving. */
const REFRESH_MS = 20_000;

interface FleetValue {
  devices: FleetDevice[];
  /** True until the first answer (or first error) arrives. */
  loading: boolean;
  /** Set when the latest refresh failed; the last good list stays on screen. */
  error: string | null;
  updatedAt: number | null;
  units: Units;
  refresh(): Promise<void>;
}

const FleetContext = createContext<FleetValue | null>(null);

/** One shared copy of the fleet for the list, the detail screen and (later) the map. */
export function FleetProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [system, setSystem] = useState<UnitSystem>("imperial");
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const data = await api.get<CurrentLocationsResponse>("locations/current");
        setDevices(Array.isArray(data.devices) ? data.devices : []);
        setUpdatedAt(Date.now());
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
  }, []);

  // Display units follow the organization's setting, as on the website.
  useEffect(() => {
    api
      .get<{ unitSystem?: string }>("organization")
      .then((org) => {
        if (org.unitSystem === "metric" || org.unitSystem === "imperial") setSystem(org.unitSystem);
      })
      .catch(() => undefined);
  }, []);

  // Refresh on a timer while the app is in front, and at once when it comes back to the front.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [refresh]);

  const value = useMemo<FleetValue>(() => ({ devices, loading, error, updatedAt, units: units(system), refresh }), [devices, loading, error, updatedAt, system, refresh]);
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
