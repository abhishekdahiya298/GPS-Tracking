import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { listLoads, loadCounts, LOAD_LIST_FILTERS } from "@/lib/loads";
import { requireTenantPage } from "@/lib/request-context";
import { LoadsView } from "./loads-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loads · RIO GPS" };

export default async function LoadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await requireTenantPage("/loads");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "loads.read")) redirect("/dashboard");
  const sp = await searchParams;
  const f = typeof sp.filter === "string" ? sp.filter : "active";
  const filter = (LOAD_LIST_FILTERS as readonly string[]).includes(f) ? (f as (typeof LOAD_LIST_FILTERS)[number]) : "active";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const [loads, counts] = await Promise.all([listLoads(ctx.organizationId, { filter, q }), loadCounts(ctx.organizationId)]);
  return <LoadsView loads={loads} counts={counts} filter={filter} q={q} canWrite={contextHasPermission(ctx, "loads.write")} />;
}
