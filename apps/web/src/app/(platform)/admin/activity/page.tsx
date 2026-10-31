import { redirect } from "next/navigation";
import { parseListQuery } from "@/lib/fleet-list";
import { ActivityQuery, listActivity } from "@/lib/platform";
import { getRequestContext } from "@/lib/request-context";
import { ActivityView } from "./activity-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity log · RIO GPS" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/activity");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const q = parseListQuery(ActivityQuery, await searchParams);
  return <ActivityView data={await listActivity(q)} query={q} />;
}
