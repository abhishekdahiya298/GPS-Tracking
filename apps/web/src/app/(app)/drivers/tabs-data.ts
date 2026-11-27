import "server-only";
import { contextHasPermission, type TenantContext } from "@rio-gps/core";
import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { featureGate } from "@/lib/entitlements";
import type { DriversTabs } from "./drivers-tabs";

type Props = Parameters<typeof DriversTabs>[0];

/** Counts for the Drivers | Loads switch. Loads only when the plan and role allow them. */
export async function loadsTabStats(ctx: TenantContext): Promise<Props["loads"]> {
  if (!contextHasPermission(ctx, "loads.read")) return null;
  if ((await featureGate(ctx, "loads")) !== "open") return null;
  // One small count query (this runs on every Drivers page view).
  const [c] = await getDb().execute<{ active: number; on_road: number; waiting: number; late: number }>(sql`
    select count(*)::int as active,
      count(*) filter (where status in ('tracking', 'at_pickup', 'in_transit', 'at_delivery'))::int as on_road,
      count(*) filter (where status = 'invited')::int as waiting,
      count(*) filter (where status in ('tracking', 'in_transit') and late_alert_target is not null)::int as late
    from loads where organization_id = ${ctx.organizationId} and status not in ('delivered', 'cancelled', 'declined')`);
  const onRoad = Number(c?.on_road ?? 0);
  const waiting = Number(c?.waiting ?? 0);
  const late = Number(c?.late ?? 0);
  const stats: NonNullable<Props["loads"]>["stats"] = [];
  if (onRoad) stats.push({ label: `${onRoad} on the road`, tone: "blue" });
  if (waiting) stats.push({ label: `${waiting} waiting`, tone: "orange" });
  if (late) stats.push({ label: `${late} late`, tone: "red" });
  return { count: Number(c?.active ?? 0), stats };
}

export function driversTabStats(c: Record<string, number>): Props["drivers"] {
  const stats: Props["drivers"]["stats"] = [];
  if (c.sharing) stats.push({ label: `${c.sharing} sharing`, tone: "green" });
  if (c.pending) stats.push({ label: `${c.pending} waiting`, tone: "orange" });
  if (c.location_off) stats.push({ label: `${c.location_off} location off`, tone: "red" });
  return { count: c.active ?? 0, stats };
}
