import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { listLeads } from "@/lib/leads";
import { getRequestContext } from "@/lib/request-context";
import { LeadsView } from "./leads-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads · RIO GPS" };

export default async function LeadsPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/leads");
  // Platform admins only; the update API re-checks isSuperAdmin.
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const { leads, newCount } = await listLeads();
  return (
    <>
      <PageHeader title="Leads" description={`Pricing requests from the public site. ${newCount} new.`} />
      <LeadsView leads={leads} />
    </>
  );
}
