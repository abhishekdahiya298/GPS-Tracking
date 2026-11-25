import { redirect } from "next/navigation";
import { getSignupSettings, getUpgradeContact } from "@/lib/entitlements";
import { listLeads } from "@/lib/leads";
import { listPlans } from "@/lib/plans";
import { getRequestContext } from "@/lib/request-context";
import { isEmailEnabled } from "@/lib/email";
import { smsConfigured } from "@/lib/sms";
import { SignupSettingsView } from "./signup-settings-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-up & upgrades · RIO GPS" };

export default async function SignupSettingsPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/signup");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const [signup, contact, plans, leads] = await Promise.all([getSignupSettings(), getUpgradeContact(), listPlans(), listLeads(50)]);
  return (
    <SignupSettingsView
      signup={signup}
      contact={contact}
      plans={plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, visibility: p.visibility }))}
      smsReady={smsConfigured()}
      emailReady={isEmailEnabled()}
      requests={leads.leads.filter((l) => l.source !== "website").slice(0, 6)}
    />
  );
}
