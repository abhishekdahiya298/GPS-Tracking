import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listDevices, listVehicles } from "@/lib/vehicles";
import { VehiclesManager } from "./vehicles-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vehicles · RIO GPS" };

export default async function VehiclesPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/vehicles");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "vehicles.read")) redirect("/dashboard");
  const [vehicles, devices] = await Promise.all([listVehicles(ctx.organizationId), listDevices(ctx.organizationId)]);
  // Permissions are passed only to shape the UI; every API call re-checks them server-side.
  const can = {
    create: contextHasPermission(ctx, "vehicles.create"),
    update: contextHasPermission(ctx, "vehicles.update"),
    remove: contextHasPermission(ctx, "vehicles.delete"),
    assign: contextHasPermission(ctx, "devices.assign"),
    unassign: contextHasPermission(ctx, "devices.unassign")
  };
  return <VehiclesManager initialVehicles={vehicles} initialDevices={devices} can={can} />;
}
