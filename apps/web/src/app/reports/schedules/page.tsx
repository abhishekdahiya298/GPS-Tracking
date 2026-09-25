import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { isEmailEnabled } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { listSchedules } from "@/lib/report-schedules";
import { listMembers } from "@/lib/team";
import { listDevices } from "@/lib/vehicles";
import { SchedulesManager } from "./schedules-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report emails · RIO GPS" };

export default async function SchedulesPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/reports/schedules");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "reports.manage")) redirect("/reports");
  const [schedules, members, devices] = await Promise.all([listSchedules(ctx.organizationId), listMembers(ctx.organizationId), listDevices(ctx.organizationId)]);
  return (
    <SchedulesManager
      initial={schedules}
      members={members.map((m) => ({ id: m.userId, label: `${m.name} <${m.email}>` }))}
      devices={devices.map((d) => ({ id: d.id, label: d.vehicle ? `${d.vehicle.name} (${d.name ?? d.model ?? "device"})` : (d.name ?? d.model ?? "Device") }))}
      myUserId={ctx.userId}
      emailEnabled={isEmailEnabled()}
    />
  );
}
