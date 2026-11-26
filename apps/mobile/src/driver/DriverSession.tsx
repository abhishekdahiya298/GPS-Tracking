import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { driver, driverTokens, onDriverSignedOut, type DriverMe, type PhoneStart } from "./api";
import { registerDriverPush } from "./push";
import { phonePermission, sendReport, startTracking, stopTracking } from "./tracking";

const ME_KEY = "rio.driver-me";
const SETUP_KEY = "rio.driver-setup-done";
export const NEW_KEY = "rio.driver-new";

type State = { status: "loading" } | { status: "none" } | { status: "ended"; company: string | null } | { status: "signedIn"; me: DriverMe; setupDone: boolean };

interface DriverSessionValue {
  state: State;
  signInWithInvite(token: string): Promise<void>;
  startPhone(phone: string): Promise<PhoneStart>;
  verifyPhone(phone: string, code: string, name?: string): Promise<void>;
  /** After D2/D2B/D2C: remember set-up is done and start sharing. */
  finishSetup(): Promise<void>;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  /** The sign-in already ended on the server (left the last company): clear this phone. */
  forget(): Promise<void>;
  /** Leave the "You're signed out" screen. */
  dismissEnded(): void;
}

const Ctx = createContext<DriverSessionValue | null>(null);

const readJson = async <T,>(key: string): Promise<T | null> => {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export function DriverSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const enter = useCallback(async () => {
    const me = await driver.me();
    await SecureStore.setItemAsync(ME_KEY, JSON.stringify(me)).catch(() => undefined);
    const setupDone = (await SecureStore.getItemAsync(SETUP_KEY).catch(() => null)) === "1";
    setState({ status: "signedIn", me, setupDone });
    if (setupDone) {
      void startTracking(me.company.name);
      void registerDriverPush(false);
      void sendReport();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await driverTokens.get())) return !cancelled && setState({ status: "none" });
      try {
        await enter();
      } catch {
        // No signal: keep the driver signed in with what we knew; the next request settles it.
        const me = await readJson<DriverMe>(ME_KEY);
        if (cancelled) return;
        if (me) {
          const setupDone = (await SecureStore.getItemAsync(SETUP_KEY).catch(() => null)) === "1";
          setState({ status: "signedIn", me, setupDone });
          if (setupDone) void startTracking(me.company.name);
        } else setState({ status: "none" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enter]);

  // The company signed the driver out (or made them inactive): stop at once and say so (D15).
  useEffect(
    () =>
      onDriverSignedOut(() => {
        void stopTracking();
        void (async () => {
          const me = await readJson<DriverMe>(ME_KEY);
          await SecureStore.deleteItemAsync(ME_KEY).catch(() => undefined);
          setState({ status: "ended", company: me?.company.name ?? null });
        })();
      }),
    []
  );

  const value = useMemo<DriverSessionValue>(
    () => ({
      state,
      async signInWithInvite(token) {
        await driver.redeemInvite(token);
        await SecureStore.deleteItemAsync(SETUP_KEY).catch(() => undefined);
        await enter();
      },
      startPhone: (phone) => driver.startPhone(phone),
      async verifyPhone(phone, code, name) {
        const r = await driver.verifyPhone(phone, code, name);
        // A brand-new account sees "You're in" (D1C) before the set-up steps.
        if (r.created) await SecureStore.setItemAsync(NEW_KEY, "1").catch(() => undefined);
        await SecureStore.deleteItemAsync(SETUP_KEY).catch(() => undefined);
        await enter();
      },
      async finishSetup() {
        await SecureStore.setItemAsync(SETUP_KEY, "1").catch(() => undefined);
        if (state.status === "signedIn") {
          setState({ ...state, setupDone: true });
          await startTracking(state.me.company.name);
          void sendReport();
        }
      },
      async refresh() {
        try {
          await enter();
        } catch {
          // keep what we have
        }
      },
      async signOut() {
        await stopTracking();
        await driver.setPushToken(null).catch(() => undefined);
        await driver.signOut();
        await SecureStore.deleteItemAsync(ME_KEY).catch(() => undefined);
        await SecureStore.deleteItemAsync(SETUP_KEY).catch(() => undefined);
        setState({ status: "none" });
      },
      async forget() {
        await stopTracking();
        await driverTokens.clear();
        await SecureStore.deleteItemAsync(ME_KEY).catch(() => undefined);
        await SecureStore.deleteItemAsync(SETUP_KEY).catch(() => undefined);
        setState({ status: "none" });
      },
      dismissEnded: () => setState({ status: "none" })
    }),
    [state, enter]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDriverSession(): DriverSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDriverSession must be used inside DriverSessionProvider");
  return v;
}

export { phonePermission };
