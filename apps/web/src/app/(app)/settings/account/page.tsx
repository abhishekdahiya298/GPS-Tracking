import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account · RIO GPS" };

export default async function AccountPage() {
  let user;
  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/settings/account");
    throw err;
  }
  return <AccountForm name={user.name} email={user.email} />;
}
