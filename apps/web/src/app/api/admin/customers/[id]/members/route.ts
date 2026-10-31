import { platformWrite } from "@/lib/admin-route";
import { platformCustomerContext } from "@/lib/platform-members";
import { addMember, AddMemberSchema } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Add a user to a customer (invitation email, or a one-time temporary password). */
export const POST = platformWrite(
  "admin.members.add",
  AddMemberSchema,
  async ({ user, ids, body, meta }) => addMember(await platformCustomerContext(user, ids.id!), body, meta),
  { status: 201, notFound: "Customer not found" }
);
