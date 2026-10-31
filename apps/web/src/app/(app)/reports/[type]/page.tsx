import { contextHasPermission } from "@rio-gps/core";
import { notFound, redirect } from "next/navigation";
import { ACTIVITY_REPORT_TYPES, type ActivityReportType } from "@/lib/activity-reports";
import { requireTenantPage } from "@/lib/request-context";
import { listGroups } from "@/lib/vehicle-groups";
import { listDevices } from "@/lib/vehicles";
import { ActivityReports } from "../activity-reports";

export const dynamic = "force-dynamic";

const TITLE: Record<ActivityReportType, string> = { stops: "Stops report", idling: "Idling report", speeding: "Speeding report", mileage: "Mileage report" };
const isType = (t: string): t is ActivityReportType => (ACTIVITY_REPORT_TYPES as readonly string[]).includes(t);

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return { title: `${isType(type) ? TITLE[type] : "Reports"} · RIO GPS` };
}

export default async function ActivityReportPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isType(type)) notFound();
  const rc = await requireTenantPage(`/reports/${type}`);
  if (!contextHasPermission(rc.ctx, "history.read")) redirect("/dashboard");
  const devices = (await listDevices(rc.ctx.organizationId)).map((d) => ({ id: d.id, label: d.vehicle ? d.vehicle.name : (d.name ?? d.model ?? "Device") + (d.status === "active" ? "" : " (inactive)") }));
  const groups = contextHasPermission(rc.ctx, "vehicles.read") ? (await listGroups(rc.ctx.organizationId)).map((g) => ({ id: g.id, name: g.name })) : [];
  return <ActivityReports key={type} type={type} devices={devices} groups={groups} />;
}
