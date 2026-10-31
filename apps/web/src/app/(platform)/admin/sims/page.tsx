import { redirect } from "next/navigation";
import { parseListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { listSims, SimListQuery } from "@/lib/sims";
import { SimsView } from "./sims-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "SIM cards · RIO GPS" };

export default async function SimsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/sims");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const q = parseListQuery(SimListQuery, await searchParams);
  return <SimsView data={await listSims(q)} query={q} />;
}
