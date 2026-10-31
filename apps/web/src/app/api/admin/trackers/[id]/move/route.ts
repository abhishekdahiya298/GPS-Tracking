import { platformWrite } from "@/lib/admin-route";
import { moveToCustomer, MoveSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.trackers.move", MoveSchema, async ({ user, ids, body, meta }) => (await moveToCustomer(user.userId, ids.id!, body, meta)) ?? { status: "ok" }, { notFound: "Tracker not found" });
