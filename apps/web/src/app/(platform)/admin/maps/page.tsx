import { redirect } from "next/navigation";
import { clearMapsSettingsCache, getMapsSettings, providerKeys } from "@/lib/maps-settings";
import { getRequestContext } from "@/lib/request-context";
import { MapsSettingsView } from "./maps-settings-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maps & addresses · RIO GPS" };

export default async function MapsSettingsPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/maps");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  clearMapsSettingsCache();
  return <MapsSettingsView initial={await getMapsSettings()} keys={providerKeys()} />;
}
