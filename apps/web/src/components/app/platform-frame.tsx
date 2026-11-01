import "server-only";
import { effectiveTimePrefs } from "@rio-gps/core";
import { DEFAULT_TIME_FORMAT, DEFAULT_TIME_ZONE } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import type { AuthenticatedUser } from "@/lib/authz";
import { AppShell } from "./app-shell";
import { PLATFORM_NAV } from "./nav-config";

/**
 * The platform console frame: platform navigation, no company switcher or alert bell.
 * `viewAsName` is the customer still selected for this session, if any.
 */
export async function PlatformFrame({ user, viewAsName, children }: { user: AuthenticatedUser; viewAsName: string | null; children: ReactNode }) {
  const [prefs] = await getDb().select({ timeZone: schema.users.timeZone, timeFormat: schema.users.timeFormat, navTheme: schema.users.navTheme }).from(schema.users).where(eq(schema.users.id, user.userId));
  const time = effectiveTimePrefs({ timeZone: DEFAULT_TIME_ZONE, timeFormat: DEFAULT_TIME_FORMAT }, prefs);
  return (
    <AppShell
      mode={{ kind: "platform", viewAsName }}
      nav={PLATFORM_NAV}
      user={{ name: user.name || user.email, email: user.email, roleLabel: "Platform admin", isSuperAdmin: true }}
      orgName="RIO GPS platform"
      organizations={[]}
      viewingAs={viewAsName !== null}
      unackAlerts={0}
      canSeeAlerts={false}
      unitSystem="imperial"
      timeZone={time.timeZone}
      timeFormat={time.timeFormat}
      navTheme={prefs?.navTheme ?? null}
    >
      {children}
    </AppShell>
  );
}
