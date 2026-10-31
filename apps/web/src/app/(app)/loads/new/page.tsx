import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireTenantPage } from "@/lib/request-context";
import { smsConfigured } from "@/lib/sms";
import { listVehicles } from "@/lib/vehicles";
import { LoadForm } from "../load-form";

export const dynamic = "force-dynamic";

/** The organization's vehicles with a tracker, for "track with one of our vehicles". */
async function loadVehicleOptions(organizationId: string) {
  return (await listVehicles(organizationId)).filter((v) => v.devices.length > 0).map((v) => ({ id: v.id, name: v.name }));
}
export const metadata = { title: "New load · RIO GPS" };

export default async function NewLoadPage() {
  const rc = await requireTenantPage("/loads/new");
  if (!contextHasPermission(rc.ctx, "loads.write")) redirect("/loads");
  return (
    <>
      <PageHeader title="New load" description="The driver gets a link; tracking starts when they accept and stops when the load is delivered." breadcrumbs={[{ label: "Loads", href: "/loads" }, { label: "New load" }]} />
      <LoadForm smsAvailable={smsConfigured()} vehicles={await loadVehicleOptions(rc.ctx.organizationId)} />
    </>
  );
}
