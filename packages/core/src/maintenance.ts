/**
 * Maintenance due-state, pure. An item is due by distance (km driven since the
 * last service), by time (days since the last service), or both — whichever
 * comes first. "Due soon" starts at 90% of the interval (at least 7 days /
 * 300 km before it).
 */
export type MaintenanceState = "ok" | "due_soon" | "overdue";

export interface MaintenanceSpec {
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceAt: Date;
}

export interface MaintenanceStatus {
  state: MaintenanceState;
  kmSinceService: number;
  kmRemaining: number | null;
  daysRemaining: number | null;
  dueDate: string | null; // ISO date (UTC) when the time interval ends
}

const DAY = 86_400_000;
const rank: Record<MaintenanceState, number> = { ok: 0, due_soon: 1, overdue: 2 };
const worst = (a: MaintenanceState, b: MaintenanceState) => (rank[a] >= rank[b] ? a : b);

export function maintenanceStatus(spec: MaintenanceSpec, kmSinceService: number, now: Date): MaintenanceStatus {
  let state: MaintenanceState = "ok";
  let kmRemaining: number | null = null;
  let daysRemaining: number | null = null;
  let dueDate: string | null = null;

  if (spec.intervalKm) {
    kmRemaining = Math.round((spec.intervalKm - kmSinceService) * 10) / 10;
    const soon = Math.max(300, spec.intervalKm * 0.1);
    state = worst(state, kmRemaining <= 0 ? "overdue" : kmRemaining <= soon ? "due_soon" : "ok");
  }
  if (spec.intervalDays) {
    const due = spec.lastServiceAt.getTime() + spec.intervalDays * DAY;
    dueDate = new Date(due).toISOString().slice(0, 10);
    daysRemaining = Math.ceil((due - now.getTime()) / DAY);
    const soon = Math.max(7, Math.ceil(spec.intervalDays * 0.1));
    state = worst(state, daysRemaining <= 0 ? "overdue" : daysRemaining <= soon ? "due_soon" : "ok");
  }
  return { state, kmSinceService: Math.round(kmSinceService * 10) / 10, kmRemaining, daysRemaining, dueDate };
}
