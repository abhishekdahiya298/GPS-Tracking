import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { listPlatformDrivers, PLATFORM_DRIVER_FILTERS } from "@/lib/platform-drivers";
import { getRequestContext } from "@/lib/request-context";
import { PlatformDriversView } from "./drivers-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "All drivers · RIO GPS" };

export default async function PlatformDriversPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/drivers");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const sp = await searchParams;
  const filter = (PLATFORM_DRIVER_FILTERS as readonly string[]).includes(String(sp.filter)) ? (String(sp.filter) as (typeof PLATFORM_DRIVER_FILTERS)[number]) : "all";
  const search = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await listPlatformDrivers({ search, filter, page });
  return (
    <>
      <PageHeader title="All drivers" description={`Every driver on RIO GPS: in companies, working for brokers, and independent. ${data.counts.all.toLocaleString("en-US")} in total.`} />
      <PlatformDriversView data={data} filter={filter} search={search} />
    </>
  );
}
