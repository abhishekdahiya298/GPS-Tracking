/** Pure logic for the Home screen: greeting, fleet summary bar, and who is on the move. */
import { STATE_META, countByFilter, fleetState, type FleetDevice, type FleetState } from "../fleet/model";

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Hello";
}

/** First name for the greeting: "Deepak Kumar" → "Deepak". Empty when the name is missing or an email. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.includes("@") ? "" : first;
}

export type SummaryKey = "moving" | "idle" | "stopped" | "offline";
export interface SummaryPart {
  key: SummaryKey;
  label: string;
  color: string;
  count: number;
  /** Share of the fleet, 0 to 1. */
  share: number;
}

/** The four status groups with their counts, in a fixed order, for the tiles and the coloured bar. */
export function fleetSummary(devices: FleetDevice[]): { total: number; parts: SummaryPart[] } {
  const counts = countByFilter(devices);
  const total = devices.length;
  const keys: SummaryKey[] = ["moving", "idle", "stopped", "offline"];
  return {
    total,
    parts: keys.map((key) => ({ key, label: STATE_META[key as FleetState].label, color: STATE_META[key as FleetState].color, count: counts[key], share: total > 0 ? counts[key] / total : 0 }))
  };
}

/** The moving vehicles, fastest first. */
export function onTheMove(devices: FleetDevice[], limit: number): FleetDevice[] {
  return devices
    .filter((d) => fleetState(d) === "moving")
    .sort((a, b) => (b.location?.speedKph ?? 0) - (a.location?.speedKph ?? 0))
    .slice(0, limit);
}
