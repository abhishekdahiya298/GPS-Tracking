import type { Feature, TenantContext } from "@rio-gps/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LockedPage } from "@/components/app/plan/locked-page";
import { featureGate, getUpgradeContact } from "./entitlements";

/**
 * For pages of a feature the customer's plan doesn't include: the lock page (with what the
 * feature does and a Request upgrade button), or back to the dashboard when the platform chose
 * to hide that feature. Returns null when the feature is in the plan.
 */
export async function lockedPageFor(ctx: TenantContext, feature: Feature, title: string, description?: string): Promise<ReactNode | null> {
  const gate = await featureGate(ctx, feature);
  if (gate === "open") return null;
  if (gate === "hide") redirect("/dashboard");
  return <LockedPage feature={feature} title={title} description={description} contact={await getUpgradeContact()} />;
}
