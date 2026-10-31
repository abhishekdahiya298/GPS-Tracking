import { platformWrite } from "@/lib/admin-route";
import { createSim, SimInputSchema } from "@/lib/sims";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.sims.add", SimInputSchema, ({ user, body, meta }) => createSim(user.userId, body, meta), { status: 201 });
