import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { listRenewals } from "@/lib/renewals";
import { getRequestContext } from "@/lib/request-context";
import { listMembers } from "@/lib/team";
import { listVehicles } from "@/lib/vehicles";
import { RenewalsManager } from "./renewals-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Renewals · RIO Tracking" };

export default async function RenewalsPage() {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/maintenance/renewals");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "maintenance.read")) redirect("/dashboard");
  const canWrite = contextHasPermission(ctx, "maintenance.write");
  const [renewals, vehicles, members] = await Promise.all([
    listRenewals(ctx.organizationId),
    listVehicles(ctx.organizationId),
    canWrite ? listMembers(ctx.organizationId) : Promise.resolve([])
  ]);
  return (
    <RenewalsManager
      initial={renewals}
      vehicles={vehicles.map((v) => ({ id: v.id, label: v.name }))}
      members={members.map((m) => ({ id: m.userId, label: `${m.name} <${m.email}>` }))}
      myUserId={ctx.userId}
      canWrite={canWrite}
    />
  );
}
