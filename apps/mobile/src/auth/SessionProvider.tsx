import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth, onSignedOut } from "../api";
import type { CodeKind, SessionUser, SignInResult } from "./service";

const USER_KEY = "rio.session-user";

type State = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; user: SessionUser | null };

interface SessionValue {
  state: State;
  signIn(email: string, password: string): Promise<SignInResult>;
  verifyCode(pending: string, code: string, kind: CodeKind): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function readCachedUser(): Promise<SessionUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}
const cacheUser = (user: SessionUser | null) => (user ? SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)) : SecureStore.deleteItemAsync(USER_KEY)).catch(() => undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const enter = useCallback(async (known: SessionUser | null) => {
    const user = known ?? (await auth.currentUser().catch(() => null));
    await cacheUser(user);
    setState({ status: "signedIn", user });
  }, []);

  // App start: ask the server who this token belongs to.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await auth.currentUser();
        if (cancelled) return;
        await cacheUser(user);
        setState(user ? { status: "signedIn", user } : { status: "signedOut" });
      } catch {
        // No connection or a server problem: a token is still stored, so stay signed in with
        // the last known name. The first request that reaches the server settles it.
        const user = await readCachedUser();
        if (!cancelled) setState({ status: "signedIn", user });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The server ended the session (signed out elsewhere, expired, access removed).
  useEffect(
    () =>
      onSignedOut(() => {
        void cacheUser(null);
        setState({ status: "signedOut" });
      }),
    []
  );

  const value = useMemo<SessionValue>(
    () => ({
      state,
      async signIn(email, password) {
        const result = await auth.signIn(email, password);
        if (result.step === "done") await enter(result.user);
        return result;
      },
      async verifyCode(pending, code, kind) {
        await auth.verifyCode(pending, code, kind);
        await enter(null);
      },
      async signOut() {
        await auth.signOut();
        await cacheUser(null);
        setState({ status: "signedOut" });
      }
    }),
    [state, enter]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
