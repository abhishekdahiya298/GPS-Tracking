import { platformWrite } from "@/lib/admin-route";
import { addToStockBulk, BulkStockSchema } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Add many trackers (with their SIMs) to stock from a pasted list. */
export const POST = platformWrite("admin.trackers.bulk", BulkStockSchema, ({ user, body, meta }) => addToStockBulk(user.userId, body, meta));
