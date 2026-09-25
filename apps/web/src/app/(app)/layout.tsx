import { contextHasPermission } from "@rio-gps/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { buildNav } from "@/components/app/nav-config";
import { Card } from "@/components/ui/card";
import { getRequestContext, getUnacknowledgedAlertCount } from "@/lib/request-context";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org admin", FLEET_MANAGER: "Fleet manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };

/**
 * Signed-in application frame. Navigation is filtered server-side by the same
 * permissions the pages and APIs enforce; each page keeps its own checks.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login");
  if (rc.status === "no_organization") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <Card className="max-w-md p-6 text-center">
          <h1 className="m-0 text-lg font-semibold">No organization yet</h1>
          <p className="mb-4 mt-2 text-sm text-muted-foreground">Your account isn&apos;t a member of any organization. Ask your administrator to invite you.</p>
          <SignOutButton />
        </Card>
      </main>
    );
  }
  const { user, ctx, orgName } = rc;
  const canSeeAlerts = contextHasPermission(ctx, "alerts.read");
  const unack = canSeeAlerts ? await getUnacknowledgedAlertCount(ctx.organizationId) : 0;
  const viewingAs = ctx.isSuperAdmin && ctx.role === null;
  return (
    <AppShell
      nav={buildNav(ctx)}
      user={{ name: user.name || user.email, email: user.email, roleLabel: ctx.role ? ROLE_LABEL[ctx.role] ?? ctx.role : "Platform admin", isSuperAdmin: user.isSuperAdmin }}
      orgName={orgName}
      viewingAs={viewingAs}
      unackAlerts={unack}
      canSeeAlerts={canSeeAlerts}
    >
      {children}
    </AppShell>
  );
}
