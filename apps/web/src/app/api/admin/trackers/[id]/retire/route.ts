import { platformWrite } from "@/lib/admin-route";
import { setStockRetired, StockStatusSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.trackers.retire", StockStatusSchema, async ({ user, ids, body, meta }) => (await setStockRetired(user.userId, ids.id!, body, meta)) ?? { status: "ok" }, { notFound: "Tracker not found" });
