import "server-only";
import { effectiveTimePrefs, type TenantContext, type TimeFormat, type UnitSystem } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, count, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext, type AuthenticatedUser } from "./authz";
import { AppError } from "./errors";

export type RequestContext =
  | { status: "unauthenticated" }
  | { status: "no_organization"; user: AuthenticatedUser }
  | {
      status: "ok";
      user: AuthenticatedUser;
      ctx: TenantContext;
      orgName: string;
      unitSystem: UnitSystem;
      /** Effective display zone/clock: the user's own choice, else the organization's. */
      timeZone: string;
      timeFormat: TimeFormat;
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
    if (err instanceof AppError && err.status === 403) return { status: "no_organization", user };
    throw err;
  }
  const db = getDb();
  const [[org], [prefs]] = await Promise.all([
    db
      .select({ name: schema.organizations.name, unitSystem: schema.organizations.unitSystem, timeZone: schema.organizations.timeZone, timeFormat: schema.organizations.timeFormat })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ctx.organizationId)),
    db.select({ timeZone: schema.users.timeZone, timeFormat: schema.users.timeFormat }).from(schema.users).where(eq(schema.users.id, user.userId))
  ]);
  const time = effectiveTimePrefs({ timeZone: org?.timeZone ?? "UTC", timeFormat: org?.timeFormat ?? "12h" }, prefs);
  return { status: "ok", user, ctx, orgName: org?.name ?? "Organization", unitSystem: org?.unitSystem ?? "imperial", ...time };
});

/** Unacknowledged alerts for the top-bar bell (uses the partial index). */
export const getUnacknowledgedAlertCount = cache(async (organizationId: string): Promise<number> => {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.organizationId, organizationId), isNull(schema.alertEvents.acknowledgedAt)));
  return row?.n ?? 0;
});
