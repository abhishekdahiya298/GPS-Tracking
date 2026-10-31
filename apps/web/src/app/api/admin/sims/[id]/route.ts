import { platformWrite } from "@/lib/admin-route";
import { SimPatchSchema, updateSim } from "@/lib/sims";

export const dynamic = "force-dynamic";

export const PATCH = platformWrite("admin.sims.update", SimPatchSchema, async ({ user, ids, body, meta }) => {
  await updateSim(user.userId, ids.id!, body, meta);
  return { status: "updated" };
}, { notFound: "SIM not found" });
