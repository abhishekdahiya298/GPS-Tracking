/**
 * The live stream's wire format and how its events change the fleet. Pure and unit-tested;
 * the network part is in stream.ts.
 *
 * The server (web app, /api/locations/stream) sends Server-Sent Events:
 *   snapshot → { devices }   first, on every (re)connect
 *   location → one new position for one tracker
 *   alert    → a new alert
 *   end      → { reason }    the server is closing the stream
 */
import type { FleetDevice, LocationPoint } from "./model";

export interface SseEvent {
  event: string;
  data: string;
}

/** Feed it text as it arrives, in pieces of any size; it calls back once per complete event. */
export function createSseParser(onEvent: (e: SseEvent) => void) {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length > 0) onEvent({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };
  return {
    feed(chunk: string) {
      buffer += chunk;
      for (;;) {
        const nl = buffer.search(/\r\n|\n|\r/);
        if (nl === -1) break;
        // A lone "\r" at the very end may be the first half of "\r\n": wait for more.
        if (buffer[nl] === "\r" && nl === buffer.length - 1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === "\r" && buffer[nl + 1] === "\n" ? 2 : 1));
        if (line === "") dispatch();
        else if (line.startsWith(":")) continue; // keep-alive comment
        else {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
      }
    }
  };
}

export interface LiveLocationEvent extends LocationPoint {
  deviceId: string;
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * A new position for one tracker. Returns the updated tracker, or null when the event is for
 * a tracker we don't have or is not newer than what we show (events can arrive out of order).
 */
export function applyLocation(current: ReadonlyMap<string, FleetDevice>, e: LiveLocationEvent): FleetDevice | null {
  const d = current.get(e.deviceId);
  if (!d || typeof e.recordedAt !== "string" || !Number.isFinite(e.latitude) || !Number.isFinite(e.longitude)) return null;
  if (d.location && d.location.recordedAt >= e.recordedAt) return null;
  const location: LocationPoint = {
    latitude: e.latitude,
    longitude: e.longitude,
    speedKph: e.speedKph ?? null,
    headingDeg: e.headingDeg ?? null,
    altitudeM: e.altitudeM ?? null,
    ignition: e.ignition ?? null,
    motion: e.motion ?? null,
    recordedAt: e.recordedAt,
    receivedAt: e.receivedAt
  };
  return { ...d, location, connectivity: "online", lastSeenAt: e.receivedAt ?? d.lastSeenAt };
}

/**
 * A full list from the server (snapshot or a normal refresh) replaces what we have, except
 * that a live position which got here first is kept when it is newer.
 */
export function mergeSnapshot(current: ReadonlyMap<string, FleetDevice>, incoming: FleetDevice[]): Map<string, FleetDevice> {
  const next = new Map<string, FleetDevice>();
  for (const d of incoming) {
    const old = current.get(d.deviceId);
    const keepOld = old?.location && d.location && old.location.recordedAt > d.location.recordedAt;
    next.set(d.deviceId, keepOld ? { ...d, location: old.location, connectivity: old.connectivity, lastSeenAt: old.lastSeenAt } : d);
  }
  return next;
}

/** Wait before reconnecting: 2 s, 4 s, 8 s … capped at 30 s. */
export const backoffMs = (attempt: number): number => Math.min(30_000, 1000 * 2 ** Math.min(Math.max(attempt, 1), 5));
