/**
 * What the driver tabs show: the driver's loads, whether the phone is sharing, and when it last
 * sent. Refreshed when the app comes to the front and every minute while it's open.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, Linking, Platform } from "react-native";
import { driver } from "./api";
import { useDriverSession } from "./DriverSession";
import type { DriverLoad, Permission } from "./model";
import { phonePermission, sendReport, startTracking } from "./tracking";

interface DriverData {
  loads: DriverLoad[] | null;
  loadsError: boolean;
  permission: Permission;
  locationEnabled: boolean;
  lastSentAt: string | null;
  refresh(): Promise<void>;
  /** Opens the phone's settings for this app, to turn location on or to Always. */
  openLocationSettings(): void;
}

const Ctx = createContext<DriverData | null>(null);

export function DriverDataProvider({ children }: { children: ReactNode }) {
  const session = useDriverSession();
  const [loads, setLoads] = useState<DriverLoad[] | null>(null);
  const [loadsError, setLoadsError] = useState(false);
  const [perm, setPerm] = useState<{ permission: Permission; locationEnabled: boolean }>({ permission: "always", locationEnabled: true });
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const company = session.state.status === "signedIn" ? session.state.me.company.name : "";

  const refresh = useCallback(async () => {
    const p = await phonePermission();
    setPerm(p);
    if (p.permission !== "off" && company) void startTracking(company);
    if (await sendReport()) setLastSentAt(new Date().toISOString());
    try {
      setLoads(await driver.loads());
      setLoadsError(false);
    } catch {
      setLoadsError(true);
    }
    void session.refresh();
  }, [company]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [refresh]);

  const value = useMemo<DriverData>(
    () => ({
      loads,
      loadsError,
      permission: perm.permission,
      locationEnabled: perm.locationEnabled,
      lastSentAt,
      refresh,
      openLocationSettings: () => {
        if (Platform.OS === "android" && !perm.locationEnabled) void Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => Linking.openSettings());
        else void Linking.openSettings();
      }
    }),
    [loads, loadsError, perm, lastSentAt, refresh]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDriverData(): DriverData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDriverData must be used inside DriverDataProvider");
  return v;
}

/** Opens turn-by-turn directions to a stop in the phone's maps app. */
export function navigateTo(lat: number, lon: number, label: string) {
  const at = `${lat},${lon}`;
  const url = Platform.OS === "ios" ? `http://maps.apple.com/?daddr=${at}&q=${encodeURIComponent(label)}` : `google.navigation:q=${at}`;
  void Linking.openURL(url).catch(() => Linking.openURL(`geo:${at}?q=${at}(${encodeURIComponent(label)})`));
}
