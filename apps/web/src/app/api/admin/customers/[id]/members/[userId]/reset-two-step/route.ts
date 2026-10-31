import { platformWrite } from "@/lib/admin-route";
import { platformCustomerContext } from "@/lib/platform-members";
import { resetMemberTwoStep } from "@/lib/team";

export const dynamic = "force-dynamic";

export const POST = platformWrite("admin.members.reset_two_step", null, async ({ user, ids, meta }) => {
  await resetMemberTwoStep(await platformCustomerContext(user, ids.id!), ids.userId!, meta);
  return { status: "reset" };
});
