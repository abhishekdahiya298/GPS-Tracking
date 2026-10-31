import { platformWrite } from "@/lib/admin-route";
import { platformCustomerContext } from "@/lib/platform-members";
import { renameMember, RenameSchema } from "@/lib/team";

export const dynamic = "force-dynamic";

/** PATCH { name } — a platform admin corrects a customer user's name. */
export const PATCH = platformWrite("admin.members.rename", RenameSchema, async ({ user, ids, body, meta }) => {
  await renameMember(await platformCustomerContext(user, ids.id!), ids.userId!, body.name, meta);
  return { status: "updated" };
});
