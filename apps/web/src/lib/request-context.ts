import "server-only";
import { effectiveTimePrefs, type TenantContext, type TimeFormat, type UnitSystem } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, count, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext, type AuthenticatedUser } from "./authz";
import { AppError, OrganizationUnavailableError, PlatformOnlyError } from "./errors";
import type { OrganizationStatus } from "./organization-status";

export type RequestContext =
  | { status: "unauthenticated" }
  | { status: "no_organization"; user: AuthenticatedUser }
  /** Every company this person belongs to is suspended or archived. */
  | { status: "organization_unavailable"; user: AuthenticatedUser; organizationStatus: "suspended" | "archived" }
  /** A platform admin with no customer chosen: the platform console. */
  | { status: "platform"; user: AuthenticatedUser }
  | {
      status: "ok";
      user: AuthenticatedUser;
      ctx: TenantContext;
      orgName: string;
      /** Only ever not "active" for a platform admin viewing a suspended or archived customer. */
      orgStatus: OrganizationStatus;
      unitSystem: UnitSystem;
      /** Effective display zone/clock: the user's own choice, else the organization's. */
      timeZone: string;
      timeFormat: TimeFormat;
      /** The person's side-menu style (null = default). */
      navTheme: string | null;
    };

/**
 * Session + tenant for the current request, computed once per request and
 * shared by the layout and the page (React cache). Pages still perform their
 * own permission checks; this only removes the duplicate lookups.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  let user: AuthenticatedUser;
  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
  } catch (err) {
    if (err instanceof AppError && err.status === 401) return { status: "unauthenticated" };
    throw err;
  }
  let ctx: TenantContext;
  try {
    ctx = await resolveTenantContext(user);
  } catch (err) {
    if (err instanceof PlatformOnlyError) return { status: "platform", user };
    if (err instanceof OrganizationUnavailableError) return { status: "organization_unavailable", user, organizationStatus: err.organizationStatus };
    if (err instanceof AppError && err.status === 403) return { status: "no_organization", user };
    throw err;
  }
  const db = getDb();
  const [[org], [prefs]] = await Promise.all([
    db
      .select({ name: schema.organizations.name, status: schema.organizations.status, unitSystem: schema.organizations.unitSystem, timeZone: schema.organizations.timeZone, timeFormat: schema.organizations.timeFormat })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ctx.organizationId)),
    db.select({ timeZone: schema.users.timeZone, timeFormat: schema.users.timeFormat, navTheme: schema.users.navTheme }).from(schema.users).where(eq(schema.users.id, user.userId))
  ]);
  const time = effectiveTimePrefs({ timeZone: org?.timeZone ?? "UTC", timeFormat: org?.timeFormat ?? "12h" }, prefs);
  return { status: "ok", user, ctx, orgName: org?.name ?? "Organization", orgStatus: org?.status ?? "active", unitSystem: org?.unitSystem ?? "imperial", ...time, navTheme: prefs?.navTheme ?? null };
});

export type TenantRequestContext = Extract<RequestContext, { status: "ok" }>;

/**
 * For pages that show one company's data. Anyone else is sent where they belong: signed-out
 * visitors to sign in, platform admins with no customer chosen to the platform console, and
 * people without a usable company to the layout's explanation (never back to /login, which
 * would bounce a signed-in person straight back here).
 */
export async function requireTenantPage(next: string): Promise<TenantRequestContext> {
  const rc = await getRequestContext();
  if (rc.status === "ok") return rc;
  if (rc.status === "unauthenticated") redirect(`/login?next=${encodeURIComponent(next)}`);
  if (rc.status === "platform") redirect("/admin");
  redirect("/no-access");
}

/** Unacknowledged alerts for the top-bar bell (uses the partial index). */
export const getUnacknowledgedAlertCount = cache(async (organizationId: string): Promise<number> => {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.organizationId, organizationId), isNull(schema.alertEvents.acknowledgedAt)));
  return row?.n ?? 0;
});
