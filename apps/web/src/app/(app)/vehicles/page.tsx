import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { listVehiclesPage, parseListQuery, VehicleListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { VehiclesView } from "./vehicles-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vehicles · RIO GPS" };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/vehicles");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "vehicles.read")) redirect("/dashboard");
  const q = parseListQuery(VehicleListQuery, await searchParams);
  const data = await listVehiclesPage(ctx.organizationId, q, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);
  // Permissions only shape the UI; every API call re-checks them on the server.
  const can = {
    create: contextHasPermission(ctx, "vehicles.create"),
    update: contextHasPermission(ctx, "vehicles.update"),
    remove: contextHasPermission(ctx, "vehicles.delete"),
    assign: contextHasPermission(ctx, "devices.assign"),
    unassign: contextHasPermission(ctx, "devices.unassign"),
    map: contextHasPermission(ctx, "locations.read")
  };
  return <VehiclesView data={data} query={q} can={can} />;
}
