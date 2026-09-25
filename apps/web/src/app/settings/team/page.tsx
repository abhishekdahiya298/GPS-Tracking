import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listMembers } from "@/lib/team";
import { TeamManager } from "./team-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team · RIO GPS" };

export default async function TeamPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/settings/team");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "users.read")) redirect("/dashboard");
  const members = await listMembers(ctx.organizationId);
  return <TeamManager initialMembers={members} you={ctx.userId} canManage={contextHasPermission(ctx, "users.manage")} />;
}
