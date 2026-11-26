import { platformWrite } from "@/lib/admin-route";
import { seedDemoData } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

/** POST (platform admin): fill the demo carrier and demo broker with test data. Safe to run again. */
export const POST = platformWrite("admin.demo_data", null, ({ user, meta }) => seedDemoData(user.userId, meta));
