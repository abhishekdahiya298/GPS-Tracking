import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { buildNav } from "@/components/app/nav-config";
import { PlatformFrame } from "@/components/app/platform-frame";
import { listMyOrganizations } from "@/lib/my-organizations";
import { getRequestContext, getUnacknowledgedAlertCount } from "@/lib/request-context";

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org admin", FLEET_MANAGER: "Fleet manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };

/**
 * Signed-in application frame. Navigation is filtered server-side by the same
 * permissions the pages and APIs enforce; each page keeps its own checks.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login");
  if (rc.status === "platform") {
    // A platform admin with no customer chosen, on a page that works without one (My account).
    return (
      <PlatformFrame user={rc.user} viewAsName={null}>
        {children}
      </PlatformFrame>
    );
  }
  if (rc.status !== "ok") redirect("/no-access");
  const { user, ctx, orgName, orgStatus, unitSystem, timeZone, timeFormat, navTheme } = rc;
  const canSeeAlerts = contextHasPermission(ctx, "alerts.read");
  // A platform admin has no companies of their own: the switcher stays empty for them.
  const [unack, mine] = await Promise.all([canSeeAlerts ? getUnacknowledgedAlertCount(ctx.organizationId) : 0, user.isSuperAdmin ? [] : listMyOrganizations(user.userId)]);
  const viewingAs = ctx.isSuperAdmin && ctx.role === null;
  return (
    <AppShell
      mode={{ kind: "tenant", orgStatus }}
      nav={buildNav(ctx)}
      user={{ name: user.name || user.email, email: user.email, roleLabel: ctx.role ? ROLE_LABEL[ctx.role] ?? ctx.role : "Platform admin", isSuperAdmin: user.isSuperAdmin }}
      orgName={orgName}
      organizations={mine.map((o) => ({ id: o.id, name: o.name, roleLabel: ROLE_LABEL[o.role] ?? o.role, current: o.id === ctx.organizationId }))}
      viewingAs={viewingAs}
      unackAlerts={unack}
      canSeeAlerts={canSeeAlerts}
      unitSystem={unitSystem}
      timeZone={timeZone}
      timeFormat={timeFormat}
      navTheme={navTheme}
    >
      {children}
    </AppShell>
  );
}
