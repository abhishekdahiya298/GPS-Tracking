import { platformWrite } from "@/lib/admin-route";
import { returnToStock, ReturnSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.trackers.return", ReturnSchema, async ({ user, ids, body, meta }) => (await returnToStock(user.userId, ids.id!, body, meta)) ?? { status: "ok" }, { notFound: "Tracker not found" });
