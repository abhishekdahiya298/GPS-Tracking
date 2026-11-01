import { redirect } from "next/navigation";
import { CustomerListQuery, listCustomersPage } from "@/lib/customers";
import { parseListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { termsSummary } from "@/lib/plan-format";
import { listPlans } from "@/lib/plans";
import { CustomersView } from "./customers-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers · RIO GPS" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/customers");
  // Platform admins only; every API behind this page re-checks isSuperAdmin.
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const sp = await searchParams;
  const q = parseListQuery(CustomerListQuery, sp);
  const [data, plans] = await Promise.all([listCustomersPage(q), listPlans()]);
  const options = plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, summary: termsSummary(p).join(" · ") }));
  return <CustomersView data={data} query={q} startCreating={sp.new === "1"} plans={options} />;
}
