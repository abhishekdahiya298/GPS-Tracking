import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, api } from "../api";
import { markRead, mergeEvents, type AlertEvent, type AlertsResponse } from "./model";

const PAGE = 50;
const REFRESH_MS = 30_000;

interface AlertsValue {
  events: AlertEvent[];
  unread: number;
  unreadOnly: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  setUnreadOnly(on: boolean): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  /** Returns an error message, or null when it worked. */
  acknowledge(ids: number[] | "all"): Promise<string | null>;
}

const AlertsContext = createContext<AlertsValue | null>(null);
const messageOf = (e: unknown, forbidden: string) => (e instanceof ApiError ? (e.kind === "forbidden" ? forbidden : e.message) : "Something went wrong.");

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnlyState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Answers that arrive after the filter changed are for a list no longer on screen.
  const generation = useRef(0);
  const filter = useRef(false);

  const load = useCallback(async (mode: "replace" | "top") => {
    const gen = generation.current;
    try {
      const data = await api.get<AlertsResponse>("alerts", { limit: PAGE, unacknowledged: filter.current ? 1 : 0 });
      if (gen !== generation.current) return;
      const page = Array.isArray(data.events) ? data.events : [];
      // "top" keeps older pages already loaded; in the unread view the server's list is the truth.
      setEvents((current) => (mode === "top" && !filter.current ? mergeEvents(current, page) : page));
      if (mode === "replace" || filter.current) setHasMore(page.length === PAGE);
      setUnread(typeof data.unacknowledged === "number" ? data.unacknowledged : 0);
      setError(null);
    } catch (e) {
      if (gen !== generation.current) return;
      if (!(e instanceof ApiError && e.kind === "unauthorized")) setError(messageOf(e, "Your account can't view alerts."));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  const setUnreadOnly = useCallback(
    (on: boolean) => {
      if (filter.current === on) return;
      filter.current = on;
      generation.current++;
      setUnreadOnlyState(on);
      setEvents([]);
      setHasMore(false);
      setLoading(true);
      void load("replace");
    },
    [load]
  );

  const loadMore = useCallback(async () => {
    const last = events[events.length - 1];
    if (!hasMore || loadingMore || !last) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const data = await api.get<AlertsResponse>("alerts", { limit: PAGE, unacknowledged: filter.current ? 1 : 0, beforeId: last.id });
      if (gen !== generation.current) return;
      const page = Array.isArray(data.events) ? data.events : [];
      setEvents((current) => mergeEvents(current, page));
      setHasMore(page.length === PAGE);
    } catch {
      // Scrolling again retries; the list already on screen stays.
    } finally {
      setLoadingMore(false);
    }
  }, [events, hasMore, loadingMore]);

  const acknowledge = useCallback(
    async (ids: number[] | "all") => {
      try {
        await api.post("alerts/acknowledge", ids === "all" ? { all: true } : { ids });
        setEvents((current) => markRead(current, ids, new Date().toISOString(), filter.current));
        setUnread((n) => (ids === "all" ? 0 : Math.max(0, n - ids.length)));
        void load("top");
        return null;
      } catch (e) {
        return messageOf(e, "Your account can't mark alerts as read.");
      }
    },
    [load]
  );

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void load("top");
      timer = setInterval(() => void load("top"), REFRESH_MS);
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
  }, [load]);

  const refresh = useCallback(() => load("top"), [load]);
  const value = useMemo<AlertsValue>(
    () => ({ events, unread, unreadOnly, loading, loadingMore, hasMore, error, setUnreadOnly, refresh, loadMore, acknowledge }),
    [events, unread, unreadOnly, loading, loadingMore, hasMore, error, setUnreadOnly, refresh, loadMore, acknowledge]
  );
  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsValue {
  const value = useContext(AlertsContext);
  if (!value) throw new Error("useAlerts must be used inside AlertsProvider");
  return value;
}
