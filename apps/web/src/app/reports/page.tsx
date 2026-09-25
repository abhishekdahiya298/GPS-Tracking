import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listDevices } from "@/lib/vehicles";
import { TripReports } from "./trip-reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trip reports · RIO GPS" };

export default async function ReportsPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/reports");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "history.read")) redirect("/dashboard");
  const devices = (await listDevices(ctx.organizationId)).map((d) => ({ id: d.id, label: d.vehicle ? `${d.vehicle.name} (${d.model ?? "device"})` : (d.model ?? "Device") }));
  return <TripReports devices={devices} />;
}
