import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listItems } from "@/lib/maintenance";
import { listMembers } from "@/lib/team";
import { listVehicles } from "@/lib/vehicles";
import { MaintenanceManager } from "./maintenance-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance · RIO GPS" };

export default async function MaintenancePage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/maintenance");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "maintenance.read")) redirect("/dashboard");
  const canWrite = contextHasPermission(ctx, "maintenance.write");
  const [items, vehicles, members] = await Promise.all([
    listItems(ctx.organizationId),
    listVehicles(ctx.organizationId),
    canWrite ? listMembers(ctx.organizationId) : Promise.resolve([])
  ]);
  return (
    <MaintenanceManager
      initial={items}
      vehicles={vehicles.map((v) => ({ id: v.id, label: v.name }))}
      members={members.map((m) => ({ id: m.userId, label: `${m.name} <${m.email}>` }))}
      myUserId={ctx.userId}
      canWrite={canWrite}
    />
  );
}
