import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getOrgSettings } from "@/lib/organization";
import { getRequestContext } from "@/lib/request-context";
import { OrgSettingsForm } from "./org-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · RIO GPS" };

export default async function OrganizationSettingsPage() {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/settings/organization");
  if (!contextHasPermission(rc.ctx, "organization.manage")) redirect("/dashboard");
  const settings = await getOrgSettings(rc.ctx.organizationId);
  return (
    <>
      <PageHeader title="Settings" description="Organization-wide preferences. They apply to everyone in your organization." />
      <OrgSettingsForm name={settings.name} initialUnits={settings.unitSystem} />
    </>
  );
}
