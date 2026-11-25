import { redirect } from "next/navigation";
import { clearPlatformSettingsCache, getPlatformSettings } from "@/lib/platform-settings";
import { getRequestContext } from "@/lib/request-context";
import { PlatformSettingsView } from "./platform-settings-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform settings · RIO GPS" };

export default async function PlatformSettingsPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/settings");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  clearPlatformSettingsCache();
  return <PlatformSettingsView initial={await getPlatformSettings()} />;
}
