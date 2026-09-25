import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import { parseListQuery } from "@/lib/fleet-list";
import { getRequestContext } from "@/lib/request-context";
import { listMembersPage, TeamListQuery } from "@/lib/team-list";
import { TeamView } from "./team-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team · RIO GPS" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const rc = await getRequestContext();
  if (rc.status !== "ok") redirect("/login?next=/settings/team");
  const { ctx } = rc;
  if (!contextHasPermission(ctx, "users.read")) redirect("/dashboard");
  const q = parseListQuery(TeamListQuery, await searchParams);
  const data = await listMembersPage(ctx.organizationId, q);
  return <TeamView data={data} query={q} you={ctx.userId} canManage={contextHasPermission(ctx, "users.manage")} />;
}
