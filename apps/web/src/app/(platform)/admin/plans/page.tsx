import { redirect } from "next/navigation";
import { getFeatureRules } from "@/lib/entitlements";
import { listPlans } from "@/lib/plans";
import { getRequestContext } from "@/lib/request-context";
import { PlansView } from "./plans-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans · RIO GPS" };

export default async function PlansPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin/plans");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const [plans, rules] = await Promise.all([listPlans(), getFeatureRules()]);
  return <PlansView plans={plans} rules={rules} />;
}
