import { platformWrite } from "@/lib/admin-route";
import { InventoryPatchSchema, updateInventoryDetails } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const PATCH = platformWrite("admin.trackers.update", InventoryPatchSchema, async ({ user, ids, body, meta }) => {
  await updateInventoryDetails(user.userId, ids.id!, body, meta);
  return { status: "updated" };
}, { notFound: "Tracker not found" });
