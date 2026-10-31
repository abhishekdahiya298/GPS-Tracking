import { platformWrite } from "@/lib/admin-route";
import { addToStock, AddToStockSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Add one tracker to RIO's stock (registered in Traccar too). */
export const POST = platformWrite("admin.trackers.add", AddToStockSchema, ({ user, body, meta }) => addToStock(user.userId, body, meta), { status: 201 });
