import { lockedPageFor } from "@/lib/plan-gate";
import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listGeofences, listRules } from "@/lib/alerts";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { GeofenceEditor } from "./geofence-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zones · RIO GPS" };

export default async function GeofencesPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/geofences");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  const locked = await lockedPageFor(ctx, "zones", "Zones", "Yards, customers and borders");
  if (locked) return locked;
  if (!contextHasPermission(ctx, "geofences.read")) redirect("/dashboard");
  const canAlerts = contextHasPermission(ctx, "alerts.read");
  const [fences, rules] = await Promise.all([listGeofences(ctx.organizationId), canAlerts ? listRules(ctx.organizationId) : Promise.resolve([])]);
  return (
    <GeofenceEditor
      initial={fences}
      canWrite={contextHasPermission(ctx, "geofences.write")}
      canLive={contextHasPermission(ctx, "locations.read")}
      canAlerts={canAlerts}
      zoneRules={rules.filter((r) => r.geofenceId).map((r) => ({ geofenceId: r.geofenceId!, type: r.type, active: r.active }))}
    />
  );
}
