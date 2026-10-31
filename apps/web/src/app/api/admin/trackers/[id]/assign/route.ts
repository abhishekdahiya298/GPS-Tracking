import { platformWrite } from "@/lib/admin-route";
import { assignToCustomer, AssignSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.trackers.assign", AssignSchema, async ({ user, ids, body, meta }) => (await assignToCustomer(user.userId, ids.id!, body, meta)) ?? { status: "ok" }, { notFound: "Tracker not found" });
