import { useEffect, useState } from "react";
import { api } from "@/api";
import type { FleetState } from "@/fleet/model";
import { stillSince, type HistoryPage, type HistoryPoint } from "@/trips/model";

/** How far back to look for the last movement. */
const WINDOW_MS = 12 * 3600_000;

/**
 * Since when the chosen vehicle has been standing, from its own recorded history — the
 * "here for 3 h 51 min" bubble. Nothing is shown while it moves, or if the history can't load.
 */
export function useStillSince(deviceId: string | null, state: FleetState | null): { since: number; whole: boolean } | null {
  const [result, setResult] = useState<{ id: string; value: { since: number; whole: boolean } | null } | null>(null);
  const standing = state === "idle" || state === "stopped" || state === "parked" || state === "offline";

  useEffect(() => {
    if (!deviceId || !standing) return;
    let cancelled = false;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - WINDOW_MS).toISOString();
    (async () => {
      const points: HistoryPoint[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const res: HistoryPage = await api.get<HistoryPage>("locations/history", { deviceId, from, to, limit: 5000, cursor });
        points.push(...res.points);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      if (!cancelled) setResult({ id: deviceId, value: stillSince(points) });
    })().catch(() => {
      if (!cancelled) setResult({ id: deviceId, value: null });
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, standing]);

  return standing && result?.id === deviceId ? result.value : null;
}
