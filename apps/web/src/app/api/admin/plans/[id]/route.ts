import { platformWrite } from "@/lib/admin-route";
import { PlanInputSchema, updatePlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** Edits the catalog only; customers on this plan keep their agreed terms. */
export const PATCH = platformWrite("admin.plans.update", PlanInputSchema, ({ user, ids, body, meta }) => updatePlan(user.userId, ids.id!, body, meta), { notFound: "Plan not found" });
