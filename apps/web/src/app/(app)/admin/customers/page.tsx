import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders } from "@/lib/authz";
import { listCustomers } from "@/lib/customers";
import { AppError } from "@/lib/errors";
import { CustomersManager } from "./customers-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers · RIO GPS" };

export default async function CustomersPage() {
  let user;
  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/admin/customers");
    throw err;
  }
  if (!user.isSuperAdmin) redirect("/dashboard");
  return <CustomersManager initial={await listCustomers()} viewingAs={user.activeOrganizationId} />;
}
