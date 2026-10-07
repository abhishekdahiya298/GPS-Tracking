import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { getOrgSettings, getUserPrefs } from "@/lib/organization";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { getRequestContext } from "@/lib/request-context";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account · RIO Tracking" };

export default async function AccountPage() {
  let user;
  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/settings/account");
    throw err;
  }
  const rc = await getRequestContext();
  const [prefs, org, [me]] = await Promise.all([
    getUserPrefs(user.userId),
    rc.status === "ok" ? getOrgSettings(rc.ctx.organizationId) : Promise.resolve(null),
    getDb().select({ twoStep: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, user.userId)).limit(1)
  ]);
  return <AccountForm twoStep={me?.twoStep ?? false} name={user.name} email={user.email} prefs={prefs} orgDefaults={org ? { timeZone: org.timeZone, timeFormat: org.timeFormat } : { timeZone: "UTC", timeFormat: "12h" }} />;
}
