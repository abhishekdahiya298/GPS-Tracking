import { contextHasModule, contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { LoadAllowanceNotice } from "@/components/app/load-allowance-notice";
import { listDriversPage, DriverListQuery } from "@/lib/drivers";
import { listLoads, loadCounts, loadsDrivenLast24h, LOAD_LIST_FILTERS } from "@/lib/loads";
import { loadAllowanceNotice } from "@/lib/plans";
import { requireTenantPage } from "@/lib/request-context";
import { LoadsView } from "../../loads/loads-view";
import { DriversTabs } from "../drivers-tabs";
import { driversTabStats, loadsTabStats } from "../tabs-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drivers · Loads · RIO GPS" };

/** Drivers → Loads: the loads of your own drivers, next to the driver list (RIO Fleet has no Loads menu). */
export default async function DriversLoadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await requireTenantPage("/drivers/loads");
  if (!contextHasPermission(ctx, "vehicles.read")) redirect("/dashboard");
  const loadsTab = await loadsTabStats(ctx);
  if (!loadsTab) redirect("/drivers");
  const sp = await searchParams;
  const f = typeof sp.filter === "string" ? sp.filter : "active";
  const filter = (LOAD_LIST_FILTERS as readonly string[]).includes(f) ? (f as (typeof LOAD_LIST_FILTERS)[number]) : "active";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const canWrite = contextHasPermission(ctx, "loads.write");
  const [loads, counts, allowance, drivers] = await Promise.all([
    listLoads(ctx.organizationId, { filter, q }),
    loadCounts(ctx.organizationId),
    canWrite ? loadAllowanceNotice(ctx.organizationId) : Promise.resolve(null),
    listDriversPage(ctx.organizationId, DriverListQuery.parse({ pageSize: 25 }))
  ]);
  const driven = await loadsDrivenLast24h(ctx.organizationId, loads.filter((l) => !["delivered", "cancelled", "declined"].includes(l.status)));
  return (
    <LoadsView
      title="Drivers"
      description="Every load of your drivers: where it is, how far along, and when it gets there."
      tabs={<DriversTabs active="loads" drivers={driversTabStats(drivers.counts)} loads={loadsTab} />}
      loads={loads}
      driven={driven}
      counts={counts}
      filter={filter}
      q={q}
      canWrite={canWrite}
      notice={allowance ? <LoadAllowanceNotice allowance={allowance} planLink={contextHasPermission(ctx, "billing.read")} /> : undefined}
      fleet={contextHasModule(ctx, "gps")}
    />
  );
}
