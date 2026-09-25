import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { countUnacknowledged, listEvents, listGeofences, listRules } from "@/lib/alerts";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listVehicles } from "@/lib/vehicles";
import { AlertsManager } from "./alerts-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alerts · RIO GPS" };

export default async function AlertsPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/alerts");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "alerts.read")) redirect("/dashboard");
  const org = ctx.organizationId;
  const [events, unack, rules, fences, vehicles] = await Promise.all([
    listEvents(org, { limit: 50, unacknowledgedOnly: false }),
    countUnacknowledged(org),
    listRules(org),
    listGeofences(org),
    listVehicles(org)
  ]);
  return (
    <AlertsManager
      initialEvents={events}
      initialUnack={unack}
      initialRules={rules}
      geofences={fences.map((f) => ({ id: f.id, name: f.name }))}
      vehicles={vehicles.map((v) => ({ id: v.id, name: v.name }))}
      canWrite={contextHasPermission(ctx, "alerts.write")}
    />
  );
}
