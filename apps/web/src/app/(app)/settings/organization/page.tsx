import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getOrgSettings } from "@/lib/organization";
import { requireTenantPage } from "@/lib/request-context";
import { MapDisplayCard } from "./map-display-card";
import { OrgSettingsForm } from "./org-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · RIO GPS" };

export default async function OrganizationSettingsPage() {
  const rc = await requireTenantPage("/settings/organization");
  if (!contextHasPermission(rc.ctx, "organization.manage")) redirect("/dashboard");
  const settings = await getOrgSettings(rc.ctx.organizationId);
  return (
    <>
      <PageHeader title="Settings" description="Organization-wide preferences. They apply to everyone in your organization." />
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <OrgSettingsForm name={settings.name} initial={{ unitSystem: settings.unitSystem, timeZone: settings.timeZone, timeFormat: settings.timeFormat }} />
        <MapDisplayCard initial={settings.mapPrefs} />
      </div>
    </>
  );
}
