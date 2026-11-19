import { redirect } from "next/navigation";
import { hideDemoAccounts } from "@/lib/demo-pref";
import { getServerEnv } from "@/lib/env";
import { parseListQuery } from "@/lib/fleet-list";
import { listPlatformTrackers, PlatformTrackerQuery } from "@/lib/platform";
import { getRequestContext } from "@/lib/request-context";
import { TrackersView } from "./trackers-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trackers · RIO GPS" };

export default async function PlatformTrackersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/trackers");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const q = parseListQuery(PlatformTrackerQuery, await searchParams);
  const onlineSeconds = getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS;
  const hideDemo = await hideDemoAccounts();
  return <TrackersView data={await listPlatformTrackers(q, onlineSeconds, new Date(), hideDemo)} query={q} onlineSeconds={onlineSeconds} hideDemo={hideDemo} />;
}
