import { platformWrite } from "@/lib/admin-route";
import { importSims, SimBulkSchema } from "@/lib/sims";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.sims.bulk", SimBulkSchema, ({ user, body, meta }) => importSims(user.userId, body, meta));
