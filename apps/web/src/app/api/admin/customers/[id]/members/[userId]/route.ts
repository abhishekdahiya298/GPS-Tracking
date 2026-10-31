import { platformWrite } from "@/lib/admin-route";
import { platformCustomerContext } from "@/lib/platform-members";
import { changeRole, ChangeRoleSchema, removeMember } from "@/lib/team";

export const dynamic = "force-dynamic";

export const PATCH = platformWrite("admin.members.role", ChangeRoleSchema, async ({ user, ids, body, meta }) => {
  await changeRole(await platformCustomerContext(user, ids.id!), ids.userId!, body.role, meta);
  return { status: "updated" };
});

export const DELETE = platformWrite("admin.members.remove", null, async ({ user, ids, meta }) => {
  await removeMember(await platformCustomerContext(user, ids.id!), ids.userId!, meta);
});
