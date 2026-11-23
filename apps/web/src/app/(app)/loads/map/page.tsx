import { lockedPageFor } from "@/lib/plan-gate";
import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { listLoads } from "@/lib/loads";
import { requireTenantPage } from "@/lib/request-context";
import { LoadsMap } from "./loads-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loads map · RIO GPS" };

/** Every active load on one map. The client keeps it fresh from /api/loads. */
export default async function LoadsMapPage() {
  const rc = await requireTenantPage("/loads/map");
  const locked = await lockedPageFor(rc.ctx, "loads_map", "Loads map", "All loads on one map");
  if (locked) return locked;
  if (!contextHasPermission(rc.ctx, "loads.read")) redirect("/dashboard");
  return <LoadsMap initial={await listLoads(rc.ctx.organizationId, { filter: "active" })} canWrite={contextHasPermission(rc.ctx, "loads.write")} />;
}
