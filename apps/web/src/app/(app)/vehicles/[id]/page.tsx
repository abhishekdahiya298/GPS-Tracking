import { contextHasPermission } from "@rio-gps/core";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { listEvents } from "@/lib/alerts";
import { assignmentHistory } from "@/lib/drivers";
import { getServerEnv } from "@/lib/env";
import { getVehicleDetail, vehicleWeek } from "@/lib/fleet-list";
import { listItems } from "@/lib/maintenance";
import { getOrgSettings } from "@/lib/organization";
import { requireTenantPage } from "@/lib/request-context";
import { VehiclePageView } from "./vehicle-page-view";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Vehicle · RIO GPS" };
}

/** One vehicle, everything about it: live status, driver, last 7 days, maintenance, history and details. */
export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireTenantPage(`/vehicles/${id}`);
  if (!contextHasPermission(ctx, "vehicles.read")) redirect("/dashboard");
  if (!z.string().uuid().safeParse(id).success) notFound();
  const detail = await getVehicleDetail(ctx.organizationId, id, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, { includeImeiLast4: contextHasPermission(ctx, "devices.manage") });
  if (!detail) notFound();
  const canLocations = contextHasPermission(ctx, "locations.read");
  if (!canLocations) detail.location = null;
  const org = await getOrgSettings(ctx.organizationId);
  const [week, drivers, alerts, maintenance] = await Promise.all([
    canLocations ? vehicleWeek(ctx.organizationId, id, org.timeZone) : null,
    assignmentHistory(ctx.organizationId, { vehicleId: id }, 12),
    contextHasPermission(ctx, "alerts.read") ? listEvents(ctx.organizationId, { limit: 5, unacknowledgedOnly: false, vehicleId: id }) : [],
    contextHasPermission(ctx, "maintenance.read") ? (await listItems(ctx.organizationId)).filter((m) => m.vehicleId === id) : null
  ]);
  const can = { update: contextHasPermission(ctx, "vehicles.update"), map: canLocations, share: contextHasPermission(ctx, "vehicles.update") && canLocations };
  return <VehiclePageView detail={detail} week={week} drivers={drivers} alerts={alerts} maintenance={maintenance} can={can} />;
}
