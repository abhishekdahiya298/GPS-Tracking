import { createHash, randomBytes } from "node:crypto";
import type { TenantContext, UnitSystem } from "@rio-gps/core";
import type { TimeFormat } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { NotFoundError, TooManyRequestsError, ValidationError } from "./errors";
import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";

/**
 * Share links: a temporary public page showing ONE vehicle's current position, without
 * signing in. This is the only place location data leaves the authenticated app, so:
 *
 * - The token is 256 random bits; only its SHA-256 is stored. The link is shown once.
 * - Every link expires (at most 30 days) and can be revoked at any time.
 * - The public view returns the vehicle's name, current position, speed, heading and fix
 *   time. No history, no other vehicles, no device identifiers, no organization data.
 * - Unknown, expired and revoked tokens all get the same answer (nothing to probe).
 * - The token travels in the URL fragment and a POST body, never in a URL path or query,
 *   so it does not appear in server logs or Referer headers.
 * - Creating and revoking are audited (never with the token).
 */
type Meta = { ipAddress: string | null; userAgent: string | null };

export const SHARE_MAX_HOURS = 30 * 24;
export const SHARE_DEFAULT_HOURS = 24;
export const SHARE_DURATIONS_HOURS = [1, 8, 24, 72, 168, 720] as const;
const MAX_ACTIVE_PER_VEHICLE = 20;
const MAX_ACTIVE_PER_ORG = 500;
/** Public view: requests per IP per minute (a viewer polls 4 times a minute). */
const VIEW_LIMIT_PER_MINUTE = 120;

export const ShareInputSchema = z.object({
  vehicleId: z.string().uuid(),
  hours: z.number().int().min(1).max(SHARE_MAX_HOURS).default(SHARE_DEFAULT_HOURS),
  label: z.string().trim().max(80).nullable().default(null)
});
/** 32 random bytes, base64url (43 characters). */
export const ShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface ShareLinkDto {
  id: string;
  vehicleId: string;
  vehicleName: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdByName: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  active: boolean;
}

/** Links of the caller's organization, newest first. Tokens are not recoverable. */
export async function listShareLinks(organizationId: string, opts: { vehicleId?: string } = {}, now = new Date()): Promise<ShareLinkDto[]> {
  const s = schema.shareLinks;
  const rows = await getDb()
    .select({ s, vehicleName: schema.vehicles.name, createdByName: schema.users.name })
    .from(s)
    .innerJoin(schema.vehicles, and(eq(schema.vehicles.id, s.vehicleId), eq(schema.vehicles.organizationId, organizationId)))
    .leftJoin(schema.users, eq(schema.users.id, s.createdBy))
    .where(and(eq(s.organizationId, organizationId), opts.vehicleId ? eq(s.vehicleId, opts.vehicleId) : undefined))
    .orderBy(desc(s.createdAt))
    .limit(200);
  return rows.map(({ s: r, vehicleName, createdByName }) => ({
    id: r.id,
    vehicleId: r.vehicleId,
    vehicleName,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdByName: createdByName || null,
    viewCount: r.viewCount,
    lastViewedAt: r.lastViewedAt?.toISOString() ?? null,
    active: r.revokedAt === null && r.expiresAt > now
  }));
}

/** Returns the token once; it cannot be read back later. */
export async function createShareLink(ctx: TenantContext, input: z.infer<typeof ShareInputSchema>, meta: Meta, now = new Date()): Promise<{ id: string; token: string; expiresAt: string }> {
  const db = getDb();
  const s = schema.shareLinks;
  const [vehicle] = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, input.vehicleId), eq(schema.vehicles.organizationId, ctx.organizationId)));
  if (!vehicle) throw new NotFoundError("Vehicle not found");
  const activeWhere = and(eq(s.organizationId, ctx.organizationId), isNull(s.revokedAt), gt(s.expiresAt, now));
  const [counts] = await db
    .select({ org: sql<number>`count(*)::int`, vehicle: sql<number>`count(*) filter (where ${s.vehicleId} = ${input.vehicleId})::int` })
    .from(s)
    .where(activeWhere);
  if ((counts?.vehicle ?? 0) >= MAX_ACTIVE_PER_VEHICLE) throw new ValidationError(`This vehicle already has ${MAX_ACTIVE_PER_VEHICLE} active links. Revoke one first.`);
  if ((counts?.org ?? 0) >= MAX_ACTIVE_PER_ORG) throw new ValidationError("Too many active share links. Revoke some first.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + input.hours * 3_600_000);
  const [row] = await db
    .insert(s)
    .values({ organizationId: ctx.organizationId, vehicleId: input.vehicleId, tokenHash: hashToken(token), label: input.label, expiresAt, createdBy: ctx.userId, createdAt: now })
    .returning({ id: s.id });
  await writeAudit({
    action: "share_link.created",
    actorUserId: ctx.userId,
    organizationId: ctx.organizationId,
    targetType: "share_link",
    targetId: row!.id,
    metadata: { vehicleId: input.vehicleId, hours: input.hours, expiresAt: expiresAt.toISOString(), label: input.label },
    ...meta
  });
  return { id: row!.id, token, expiresAt: expiresAt.toISOString() };
}

/** Takes effect immediately: the next public request for this link gets "not available". */
export async function revokeShareLink(ctx: TenantContext, id: string, meta: Meta, now = new Date()): Promise<void> {
  const s = schema.shareLinks;
  const [row] = await getDb()
    .update(s)
    .set({ revokedAt: now })
    .where(and(eq(s.id, id), eq(s.organizationId, ctx.organizationId), isNull(s.revokedAt)))
    .returning({ id: s.id, vehicleId: s.vehicleId });
  if (!row) {
    const [exists] = await getDb().select({ id: s.id }).from(s).where(and(eq(s.id, id), eq(s.organizationId, ctx.organizationId)));
    if (!exists) throw new NotFoundError("Share link not found");
    return; // already revoked: idempotent
  }
  await writeAudit({ action: "share_link.revoked", actorUserId: ctx.userId, organizationId: ctx.organizationId, targetType: "share_link", targetId: id, metadata: { vehicleId: row.vehicleId }, ...meta });
}

export interface PublicShareView {
  vehicleName: string;
  expiresAt: string;
  unitSystem: UnitSystem;
  timeZone: string;
  timeFormat: TimeFormat;
  /** null: the vehicle has no tracker assigned or no position yet. */
  location: { latitude: number; longitude: number; speedKph: number | null; headingDeg: number | null; ignition: boolean | null; recordedAt: string } | null;
}

/**
 * The public view for a token, or null when the token is unknown, expired or revoked
 * (callers must answer all three identically). Exactly the fields listed in PublicShareView.
 */
export async function viewShareLink(token: string, now = new Date()): Promise<PublicShareView | null> {
  if (!ShareTokenSchema.safeParse(token).success) return null;
  const db = getDb();
  const s = schema.shareLinks;
  const [link] = await db
    .select({
      id: s.id,
      organizationId: s.organizationId,
      vehicleId: s.vehicleId,
      expiresAt: s.expiresAt,
      vehicleName: schema.vehicles.name,
      unitSystem: schema.organizations.unitSystem,
      timeZone: schema.organizations.timeZone,
      timeFormat: schema.organizations.timeFormat
    })
    .from(s)
    .innerJoin(schema.vehicles, and(eq(schema.vehicles.id, s.vehicleId), eq(schema.vehicles.organizationId, s.organizationId)))
    .innerJoin(schema.organizations, eq(schema.organizations.id, s.organizationId))
    .where(and(eq(s.tokenHash, hashToken(token)), isNull(s.revokedAt), gt(s.expiresAt, now)));
  if (!link) return null;

  // The vehicle's currently assigned, active tracker (same organization) and its latest fix.
  const cl = schema.currentLocations;
  const a = schema.deviceAssignments;
  const d = schema.gpsDevices;
  const [loc] = await db
    .select({ latitude: cl.latitude, longitude: cl.longitude, speedKph: cl.speedKph, headingDeg: cl.headingDeg, ignition: cl.ignition, recordedAt: cl.recordedAt })
    .from(a)
    .innerJoin(d, and(eq(d.id, a.deviceId), eq(d.organizationId, link.organizationId), eq(d.status, "active")))
    .innerJoin(cl, and(eq(cl.deviceId, d.id), eq(cl.organizationId, link.organizationId)))
    .where(and(eq(a.vehicleId, link.vehicleId), eq(a.organizationId, link.organizationId), isNull(a.unassignedAt)))
    .orderBy(desc(cl.recordedAt))
    .limit(1);

  // Usage counter for the owner's list; never blocks or fails the view.
  db.update(s)
    .set({ viewCount: sql`${s.viewCount} + 1`, lastViewedAt: now })
    .where(eq(s.id, link.id))
    .catch((err) => logger.error("share.view_count_failed", { shareLinkId: link.id }, err));

  return {
    vehicleName: link.vehicleName,
    expiresAt: link.expiresAt.toISOString(),
    unitSystem: link.unitSystem,
    timeZone: link.timeZone,
    timeFormat: link.timeFormat,
    location: loc ? { latitude: loc.latitude, longitude: loc.longitude, speedKph: loc.speedKph, headingDeg: loc.headingDeg, ignition: loc.ignition, recordedAt: loc.recordedAt.toISOString() } : null
  };
}

/**
 * Fixed-window limit per client address for the public view. If Redis is unavailable the
 * request is allowed (and logged): the token's 256 bits, not this limit, is what protects
 * the data; the limit only bounds load.
 */
export async function assertShareViewRate(ip: string | null, now = Date.now()): Promise<void> {
  const key = `rl:share:${ip ?? "unknown"}:${Math.floor(now / 60_000)}`;
  let n: number;
  try {
    const redis = await getReadyRedisPublisher();
    n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 90);
  } catch (err) {
    logger.warn("share.rate_limit_unavailable", {}, err);
    return;
  }
  if (n > VIEW_LIMIT_PER_MINUTE) throw new TooManyRequestsError("Too many requests. Try again in a minute.");
}
