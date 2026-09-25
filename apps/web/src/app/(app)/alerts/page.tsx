import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { listGeofences, listRules } from "@/lib/alerts";
import { AlertListQuery, listAlertsPage } from "@/lib/alerts-list";
import { parseListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { listVehicles } from "@/lib/vehicles";
import { AlertsView } from "./alerts-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alerts · RIO GPS" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/alerts");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "alerts.read")) redirect("/dashboard");
  const org = ctx.organizationId;
  const q = parseListQuery(AlertListQuery, await searchParams);
  const [page, rules, fences, vehicles] = await Promise.all([listAlertsPage(org, q), listRules(org), listGeofences(org), listVehicles(org)]);
  return (
    <AlertsView
      data={page}
      query={q}
      rules={rules}
      geofences={fences.map((f) => ({ id: f.id, name: f.name }))}
      vehicles={vehicles.map((v) => ({ id: v.id, name: v.name }))}
      canWrite={contextHasPermission(ctx, "alerts.write")}
      canMap={contextHasPermission(ctx, "history.read")}
    />
  );
}
