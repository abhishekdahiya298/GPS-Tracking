import { redirect } from "next/navigation";
import { listAppReleases } from "@/lib/app-releases";
import { getRequestContext } from "@/lib/request-context";
import { AppReleasesView } from "./app-releases-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mobile app · RIO GPS" };

export default async function MobileAppPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/app");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  return <AppReleasesView releases={await listAppReleases()} />;
}
