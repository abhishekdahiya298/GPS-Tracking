import "server-only";
import { contextHasPermission, type TenantContext } from "@rio-gps/core";
import { listLoads } from "@/lib/loads";
import { featureGate } from "@/lib/entitlements";
import type { DriversTabs } from "./drivers-tabs";

type Props = Parameters<typeof DriversTabs>[0];

/** Counts for the Drivers | Loads switch. Loads only when the plan and role allow them. */
export async function loadsTabStats(ctx: TenantContext): Promise<Props["loads"]> {
  if (!contextHasPermission(ctx, "loads.read")) return null;
  if ((await featureGate(ctx, "loads")) !== "open") return null;
  const active = await listLoads(ctx.organizationId, { filter: "active" });
  const onRoad = active.filter((l) => ["tracking", "at_pickup", "in_transit", "at_delivery"].includes(l.status)).length;
  const late = active.filter((l) => l.eta?.late).length;
  const waiting = active.filter((l) => l.status === "invited").length;
  const stats: NonNullable<Props["loads"]>["stats"] = [];
  if (onRoad) stats.push({ label: `${onRoad} on the road`, tone: "blue" });
  if (waiting) stats.push({ label: `${waiting} waiting`, tone: "orange" });
  if (late) stats.push({ label: `${late} late`, tone: "red" });
  return { count: active.length, stats };
}

export function driversTabStats(c: Record<string, number>): Props["drivers"] {
  const stats: Props["drivers"]["stats"] = [];
  if (c.sharing) stats.push({ label: `${c.sharing} sharing`, tone: "green" });
  if (c.pending) stats.push({ label: `${c.pending} waiting`, tone: "orange" });
  if (c.location_off) stats.push({ label: `${c.location_off} location off`, tone: "red" });
  return { count: c.active ?? 0, stats };
}
