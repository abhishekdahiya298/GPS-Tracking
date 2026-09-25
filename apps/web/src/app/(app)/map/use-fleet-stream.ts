"use client";
/**
 * Live fleet data over SSE (/api/locations/stream): snapshot on connect, then
 * location events; reconnects with backoff and sends the user to login when
 * the session ends. Device data lives in a ref, not React state, so a burst of
 * GPS events never re-renders the page per event: the map layer is fed through
 * callbacks and the list re-renders at most once per LIST_MS.
 */
import { useEffect, useRef, useState } from "react";
import type { AlertEventDto } from "@/lib/alerts";
import type { CurrentDeviceLocation, LiveLocationEvent } from "@/lib/locations";

export type Conn = "connecting" | "live" | "reconnecting";
const LIST_MS = 1000;

export interface StreamHandlers {
  onSnapshot: (devices: CurrentDeviceLocation[]) => void;
  onUpdate: (devices: CurrentDeviceLocation[]) => void;
  onAlert?: (a: AlertEventDto) => void;
}

export function useFleetStream(handlers: StreamHandlers) {
  const devices = useRef(new Map<string, CurrentDeviceLocation>());
  const h = useRef(handlers);
  h.current = handlers;
  const [conn, setConn] = useState<Conn>("connecting");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    let listDirty = false;
    let pending = new Map<string, CurrentDeviceLocation>();
    let flushRaf = 0;

    const listTimer = setInterval(() => {
      if (listDirty) {
        listDirty = false;
        setVersion((v) => v + 1);
      }
    }, LIST_MS);

    const flush = () => {
      flushRaf = 0;
      if (pending.size === 0) return;
      const batch = [...pending.values()];
      pending = new Map();
      h.current.onUpdate(batch);
      listDirty = true;
    };

    const connect = () => {
      setConn(attempt === 0 ? "connecting" : "reconnecting");
      es = new EventSource("/api/locations/stream");
      es.addEventListener("snapshot", (ev) => {
        attempt = 0;
        setConn("live");
        const snap = JSON.parse((ev as MessageEvent).data) as { devices: CurrentDeviceLocation[] };
        const next = new Map<string, CurrentDeviceLocation>();
        for (const d of snap.devices) {
          const old = devices.current.get(d.deviceId);
          // Keep a live update that raced ahead of the snapshot.
          next.set(d.deviceId, old?.location && d.location && old.location.recordedAt > d.location.recordedAt ? { ...d, location: old.location } : d);
        }
        devices.current = next;
        pending.clear();
        h.current.onSnapshot([...next.values()]);
        setLoaded(true);
        setVersion((v) => v + 1);
      });
      es.addEventListener("location", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as LiveLocationEvent;
        const d = devices.current.get(e.deviceId);
        if (!d) return; // not in this org's snapshot
        if (d.location && d.location.recordedAt >= e.recordedAt) return; // stale / out of order
        const location = {
          latitude: e.latitude,
          longitude: e.longitude,
          speedKph: e.speedKph,
          headingDeg: e.headingDeg,
          altitudeM: e.altitudeM,
          ignition: e.ignition,
          motion: e.motion,
          recordedAt: e.recordedAt,
          receivedAt: e.receivedAt
        };
        const updated: CurrentDeviceLocation = { ...d, location, connectivity: "online", lastSeenAt: e.receivedAt };
        devices.current.set(e.deviceId, updated);
        pending.set(e.deviceId, updated);
        if (!flushRaf) flushRaf = requestAnimationFrame(flush);
      });
      es.addEventListener("alert", (ev) => h.current.onAlert?.(JSON.parse((ev as MessageEvent).data) as AlertEventDto));
      es.addEventListener("end", (ev) => {
        const { reason } = JSON.parse((ev as MessageEvent).data) as { reason: string };
        es?.close();
        if (reason === "session_ended") window.location.assign("/login?next=/map");
        else void schedule();
      });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) void schedule();
        else setConn("reconnecting");
      };
    };

    const schedule = async () => {
      if (stopped) return;
      es?.close();
      setConn("reconnecting");
      // A non-200 (e.g. 401) closes EventSource for good; check why before retrying.
      try {
        const r = await fetch("/api/locations/current", { cache: "no-store" });
        if (r.status === 401) {
          window.location.assign("/login?next=/map");
          return;
        }
      } catch {
        // network down: keep retrying
      }
      attempt++;
      retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(listTimer);
      cancelAnimationFrame(flushRaf);
      es?.close();
    };
  }, []);

  return { devices, conn, version, loaded };
}
