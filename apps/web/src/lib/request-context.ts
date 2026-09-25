import "server-only";
import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, count, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext, type AuthenticatedUser } from "./authz";
import { AppError } from "./errors";

export type RequestContext =
  | { status: "unauthenticated" }
  | { status: "no_organization"; user: AuthenticatedUser }
  | { status: "ok"; user: AuthenticatedUser; ctx: TenantContext; orgName: string };

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
  const [org] = await getDb().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, ctx.organizationId));
  return { status: "ok", user, ctx, orgName: org?.name ?? "Organization" };
});

/** Unacknowledged alerts for the top-bar bell (uses the partial index). */
export const getUnacknowledgedAlertCount = cache(async (organizationId: string): Promise<number> => {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.organizationId, organizationId), isNull(schema.alertEvents.acknowledgedAt)));
  return row?.n ?? 0;
});
