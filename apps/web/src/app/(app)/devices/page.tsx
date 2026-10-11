import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { DeviceListQuery, listDevicesPage, parseListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { DevicesView } from "./devices-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices · RIO GPS" };

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/devices");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "devices.read")) redirect("/dashboard");
  const q = parseListQuery(DeviceListQuery, await searchParams);
  const manage = contextHasPermission(ctx, "devices.manage");
  const data = await listDevicesPage(ctx.organizationId, q, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, { includeImeiLast4: manage });
  const can = { manage, assign: contextHasPermission(ctx, "devices.assign"), unassign: contextHasPermission(ctx, "devices.unassign"), superAdmin: ctx.isSuperAdmin };
  return <DevicesView data={data} query={q} can={can} />;
}
