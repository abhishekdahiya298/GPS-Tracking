import { platformWrite } from "@/lib/admin-route";
import { createPlan, PlanInputSchema } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** New catalog plan. */
export const POST = platformWrite("admin.plans.create", PlanInputSchema, ({ user, body, meta }) => createPlan(user.userId, body, meta), { status: 201 });
