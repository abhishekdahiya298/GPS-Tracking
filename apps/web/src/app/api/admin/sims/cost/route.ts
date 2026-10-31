import { platformWrite } from "@/lib/admin-route";
import { setSimCost, SimCostSchema } from "@/lib/sims";

export const dynamic = "force-dynamic";

/** One monthly cost for every Hologram SIM (or every SIM). */
export const POST = platformWrite("admin.sims.cost", SimCostSchema, ({ user, body, meta }) => setSimCost(user.userId, body, meta));
