import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { driversByVehicle } from "@/lib/drivers";
import { getOrgSettings } from "@/lib/organization";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getMapsSettings } from "@/lib/maps-settings";
import { listGroups } from "@/lib/vehicle-groups";
import { listVehicles } from "@/lib/vehicles";
import { LiveMap } from "./live-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live map · RIO GPS" };

export default async function MapPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/map");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "locations.read")) redirect("/dashboard");
  // No location data is rendered on the server: the client loads it through the
  // session-authenticated stream, scoped to the caller's organization.
  // Groups are only names and vehicle ids of the caller's own organization.
  const groups = contextHasPermission(ctx, "vehicles.read") ? await listGroups(ctx.organizationId) : [];
  const canShare = contextHasPermission(ctx, "vehicles.update") && contextHasPermission(ctx, "locations.read");
  const [maps, org] = await Promise.all([getMapsSettings(), getOrgSettings(ctx.organizationId)]);
  const canVehicles = contextHasPermission(ctx, "vehicles.read");
  const drivers = canVehicles ? Object.fromEntries([...(await driversByVehicle(ctx.organizationId))].map(([v, d]) => [v, { name: d.name, phone: d.phone }])) : {};
  // Identity details for the list and card (VIN, year/make/model, the company's list order).
  const vehicleInfo = canVehicles
    ? Object.fromEntries((await listVehicles(ctx.organizationId)).map((v) => [v.id, { vin: v.vin, modelYear: v.modelYear, make: v.make, model: v.model, sortOrder: v.sortOrder, plateRegion: v.plateRegion }]))
    : {};
  return <LiveMap offlineSeconds={getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS} groups={groups} canShare={canShare} defaultStyle={maps.mapStyle} addresses={maps.addressProvider !== "off"} platformAdmin={ctx.isSuperAdmin} drivers={drivers} vehicleInfo={vehicleInfo} mapPrefs={org.mapPrefs} canDrivers={canVehicles} />;
}
