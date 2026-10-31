import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PlatformFrame } from "@/components/app/platform-frame";
import { getRequestContext } from "@/lib/request-context";

/**
 * Platform console (/admin): RIO GPS's own staff, never a customer role. Platform admins are not
 * members of any organization; they open a customer with "View as customer". Every page and API
 * under here checks isSuperAdmin again on the server.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  return (
    <PlatformFrame user={rc.user} viewAsName={rc.status === "ok" ? rc.orgName : null}>
      {children}
    </PlatformFrame>
  );
}
