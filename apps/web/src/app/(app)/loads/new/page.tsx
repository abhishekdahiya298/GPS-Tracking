import { contextHasModule, contextHasPermission } from "@rio-gps/core";
import { LoadAllowanceNotice } from "@/components/app/load-allowance-notice";
import { loadAllowanceNotice } from "@/lib/plans";
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
  const fleet = contextHasModule(rc.ctx, "gps");
  const [vehicles, allowance] = await Promise.all([fleet ? loadVehicleOptions(rc.ctx.organizationId) : Promise.resolve([]), loadAllowanceNotice(rc.ctx.organizationId)]);
  return (
    <>
      <PageHeader title="New load" description="The driver gets a link; tracking starts when they accept and stops when the load is delivered." breadcrumbs={[{ label: "Loads", href: "/loads" }, { label: "New load" }]} />
      <LoadForm
        smsAvailable={smsConfigured()}
        vehicles={vehicles}
        fleet={fleet}
        notice={<LoadAllowanceNotice allowance={allowance} planLink={contextHasPermission(rc.ctx, "billing.read")} />}
      />
    </>
  );
}
