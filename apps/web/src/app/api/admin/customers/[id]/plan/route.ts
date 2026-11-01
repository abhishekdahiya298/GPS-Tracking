import { platformWrite } from "@/lib/admin-route";
import { setCustomerPlan, SetPlanSchema } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** New terms for a customer, from now on (history kept). */
export const POST = platformWrite("admin.customers.plan", SetPlanSchema, ({ user, ids, body, meta }) => setCustomerPlan(user.userId, ids.id!, body, meta), { notFound: "Customer not found" });
