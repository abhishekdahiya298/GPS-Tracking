import { platformWrite } from "@/lib/admin-route";
import { platformCustomerContext } from "@/lib/platform-members";
import { resetMemberPassword } from "@/lib/team";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.members.reset_password", null, async ({ user, ids, meta }) => resetMemberPassword(await platformCustomerContext(user, ids.id!), ids.userId!, meta));
