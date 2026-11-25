import type { NormalizedPosition, TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "./audit";
import { getServerEnv } from "./env";
import { ForbiddenError, NotFoundError, UnauthenticatedError as UnauthorizedError, ValidationError } from "./errors";
import { ingestPosition } from "./ingest";
import { afterStoredPosition } from "./ingest-pipeline";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import { assertRateLimit } from "./rate-limit";
import { checkDriverSignInCode, sendDriverSignInCode } from "./signup";
import { smsConfigured } from "./sms";

/**
 * The driver app. A driver signs in with a personal invite link (works today) or with their phone
 * number and a text code (when texts work). While signed in, the phone shares its location all the
 * time: every point goes through the same pipeline as a hardware tracker (history, trips, alerts,
 * loads, live map), as a gps_devices row of kind "phone". Tracker first: the phone is the truck's
 * position only when the truck has no tracker of its own.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const INVITE_TTL_MS = 7 * 86_400_000;
const sha = (v: string) => createHash("sha256").update(`${getServerEnv().AUTH_SECRET}:driver-app:${v}`).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");
const origin = () => new URL(getServerEnv().AUTH_URL).origin;

export const phoneExternalId = (driverId: string) => `phone:${driverId}`;

// ---------- invites (carrier side) ----------

export interface DriverInviteDto {
  driverId: string;
  url: string;
  appUrl: string;
  expiresAt: string;
}

/** A personal sign-in link for one driver. Older unused links for the driver stop working. */
export async function createDriverInvite(ctx: TenantContext, driverId: string, actorUserId: string): Promise<DriverInviteDto> {
  const db = getDb();
  const [driver] = await db.select({ id: schema.drivers.id, status: schema.drivers.status }).from(schema.drivers).where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.organizationId, ctx.organizationId)));
  if (!driver) throw new NotFoundError("Driver not found");
  if (driver.status !== "active") throw new ValidationError("This driver is inactive. Make them active first.");
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.update(schema.driverInvites).set({ expiresAt: new Date() }).where(and(eq(schema.driverInvites.driverId, driverId), isNull(schema.driverInvites.usedAt)));
    await tx.insert(schema.driverInvites).values({ organizationId: ctx.organizationId, driverId, tokenHash: sha(token), expiresAt, createdBy: actorUserId });
  });
  await writeAudit({ action: "driver.app_invite_created", actorUserId, organizationId: ctx.organizationId, targetType: "driver", targetId: driverId, metadata: {}, ipAddress: null, userAgent: null });
  return { driverId, url: `${origin()}/driver-app?t=${token}`, appUrl: `riogps://driver?t=${token}`, expiresAt: expiresAt.toISOString() };
}

// ---------- sessions (driver side) ----------

export const DeviceInfoSchema = z.object({
  platform: z.enum(["ios", "android", "web"]).optional(),
  appVersion: z.string().max(40).optional(),
  deviceModel: z.string().max(80).optional()
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export interface DriverSessionDto {
  token: string;
  driver: { id: string; name: string; phone: string | null };
  company: { id: string; name: string };
}

async function startSession(driverId: string, info: DeviceInfo): Promise<DriverSessionDto> {
  const db = getDb();
  const token = newToken();
  const out = await db.transaction(async (tx) => {
    const [d] = await tx
      .select({ id: schema.drivers.id, name: schema.drivers.name, phone: schema.drivers.phone, organizationId: schema.drivers.organizationId, status: schema.drivers.status, orgName: schema.organizations.name, orgStatus: schema.organizations.status })
      .from(schema.drivers)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
      .where(eq(schema.drivers.id, driverId))
      .for("update", { of: schema.drivers });
    if (!d || d.status !== "active") throw new ForbiddenError("Your company hasn't set you up as an active driver. Ask them to add you.");
    if (d.orgStatus !== "active") throw new ForbiddenError(`${d.orgName} isn't active on RIO GPS right now.`);
    await ensurePhoneDevice(tx, d.id, d.organizationId, d.name);
    await tx.insert(schema.driverAppSessions).values({ driverId: d.id, organizationId: d.organizationId, tokenHash: sha(token), platform: info.platform ?? null, appVersion: info.appVersion ?? null, deviceModel: info.deviceModel ?? null });
    await tx
      .insert(schema.driverAppStatus)
      .values({ driverId: d.id, organizationId: d.organizationId, signedIn: true, platform: info.platform ?? null, appVersion: info.appVersion ?? null })
      .onConflictDoUpdate({ target: schema.driverAppStatus.driverId, set: { signedIn: true, platform: info.platform ?? null, appVersion: info.appVersion ?? null, updatedAt: new Date() } });
    return { token, driver: { id: d.id, name: d.name, phone: d.phone }, company: { id: d.organizationId, name: d.orgName } };
  });
  await writeAudit({ action: "driver.app_signed_in", actorUserId: null, organizationId: out.company.id, targetType: "driver", targetId: out.driver.id, metadata: { platform: info.platform ?? null }, ipAddress: null, userAgent: null });
  return out;
}

/** The driver's phone as a "device" (created once, kept across sign-ins). */
async function ensurePhoneDevice(tx: Tx, driverId: string, organizationId: string, name: string): Promise<string> {
  const [existing] = await tx.select({ id: schema.drivers.phoneDeviceId }).from(schema.drivers).where(eq(schema.drivers.id, driverId));
  if (existing?.id) {
    await tx.update(schema.gpsDevices).set({ status: "active", organizationId, updatedAt: new Date() }).where(eq(schema.gpsDevices.id, existing.id));
    return existing.id;
  }
  const [provider] = await tx.select({ id: schema.gpsProviders.id }).from(schema.gpsProviders).where(eq(schema.gpsProviders.organizationId, organizationId)).limit(1);
  const [dev] = await tx
    .insert(schema.gpsDevices)
    .values({ organizationId, providerId: provider?.id ?? null, externalDeviceId: phoneExternalId(driverId), imei: `phone-${driverId}`, kind: "phone", model: "Phone (driver app)", name: `${name}'s phone`, status: "active" })
    .onConflictDoUpdate({ target: schema.gpsDevices.imei, set: { organizationId, status: "active", updatedAt: new Date() } })
    .returning({ id: schema.gpsDevices.id });
  await tx.update(schema.drivers).set({ phoneDeviceId: dev!.id }).where(eq(schema.drivers.id, driverId));
  return dev!.id;
}

/** The personal invite link signs the driver in (once). */
export async function redeemDriverInvite(token: string, info: DeviceInfo, ip: string | null): Promise<DriverSessionDto> {
  await assertRateLimit("driver-app-invite", ip ?? "unknown", 20, 3600, "Too many tries. Try again later.");
  const db = getDb();
  const [inv] = await db.select().from(schema.driverInvites).where(eq(schema.driverInvites.tokenHash, sha(token)));
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) throw new ValidationError("This invite link has expired or was already used. Ask your company for a new one.");
  await db.update(schema.driverInvites).set({ usedAt: new Date() }).where(eq(schema.driverInvites.id, inv.id));
  return startSession(inv.driverId, info);
}

/** Phone sign-in, step 1: texts a code when the number belongs to an active driver. */
export async function startDriverPhoneSignIn(phoneRaw: string, ip: string | null): Promise<{ sentTo: string | null }> {
  if (!smsConfigured()) throw new ValidationError("Signing in by text isn't available yet. Open the invite link your company sent you.");
  await assertRateLimit("driver-app-phone", ip ?? "unknown", 10, 3600, "Too many tries. Try again later.");
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new ValidationError("Enter your mobile number, like (905) 555-0121.");
  const [d] = await activeDriversByPhone(phone);
  // Same answer whether or not the number is known, so the screen can't be used to find drivers.
  if (!d) {
    logger.info("driver_app.phone_unknown", {});
    return { sentTo: null };
  }
  const sent = await sendDriverSignInCode(phone);
  return { sentTo: sent.phone };
}

/** Phone sign-in, step 2: the right code signs the driver in. */
export async function verifyDriverPhoneSignIn(phoneRaw: string, code: string, info: DeviceInfo): Promise<DriverSessionDto> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new ValidationError("Enter your mobile number, like (905) 555-0121.");
  await checkDriverSignInCode(phone, code);
  const [d] = await activeDriversByPhone(phone);
  if (!d) throw new ForbiddenError("No company has you as an active driver. Ask them to add you.");
  return startSession(d.id, info);
}

function activeDriversByPhone(phone: string) {
  return getDb()
    .select({ id: schema.drivers.id })
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .where(and(eq(schema.drivers.phone, phone), eq(schema.drivers.status, "active"), eq(schema.organizations.status, "active")))
    .orderBy(desc(schema.drivers.updatedAt))
    .limit(1);
}

export interface DriverAuth {
  sessionId: string;
  driverId: string;
  organizationId: string;
}

/** "Authorization: Bearer <token>" from the driver app. */
export async function authenticateDriver(request: Request): Promise<DriverAuth> {
  const h = request.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new UnauthorizedError("Sign in to the driver app");
  const db = getDb();
  const [s] = await db
    .select({ id: schema.driverAppSessions.id, driverId: schema.driverAppSessions.driverId, organizationId: schema.driverAppSessions.organizationId, revokedAt: schema.driverAppSessions.revokedAt, status: schema.drivers.status, lastSeenAt: schema.driverAppSessions.lastSeenAt })
    .from(schema.driverAppSessions)
    .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverAppSessions.driverId))
    .where(eq(schema.driverAppSessions.tokenHash, sha(token)));
  if (!s || s.revokedAt || s.status !== "active") throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await db.update(schema.driverAppSessions).set({ lastSeenAt: new Date() }).where(eq(schema.driverAppSessions.id, s.id));
  return { sessionId: s.id, driverId: s.driverId, organizationId: s.organizationId };
}

export async function signOutDriver(auth: DriverAuth): Promise<void> {
  const db = getDb();
  await db.update(schema.driverAppSessions).set({ revokedAt: new Date() }).where(eq(schema.driverAppSessions.id, auth.sessionId));
  const [open] = await db.select({ id: schema.driverAppSessions.id }).from(schema.driverAppSessions).where(and(eq(schema.driverAppSessions.driverId, auth.driverId), isNull(schema.driverAppSessions.revokedAt))).limit(1);
  if (!open) await db.update(schema.driverAppStatus).set({ signedIn: false, updatedAt: new Date() }).where(eq(schema.driverAppStatus.driverId, auth.driverId));
  await writeAudit({ action: "driver.app_signed_out", actorUserId: null, organizationId: auth.organizationId, targetType: "driver", targetId: auth.driverId, metadata: {}, ipAddress: null, userAgent: null });
}

/** The carrier signs a driver out of every phone (or making them inactive does). */
export async function signOutDriverEverywhere(organizationId: string, driverId: string, actorUserId: string | null): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.driverAppSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.driverAppSessions.driverId, driverId), eq(schema.driverAppSessions.organizationId, organizationId), isNull(schema.driverAppSessions.revokedAt)))
    .returning({ id: schema.driverAppSessions.id });
  await db.update(schema.driverAppStatus).set({ signedIn: false, updatedAt: new Date() }).where(eq(schema.driverAppStatus.driverId, driverId));
  if (rows.length) await writeAudit({ action: "driver.app_signed_out_by_company", actorUserId, organizationId, targetType: "driver", targetId: driverId, metadata: { sessions: rows.length }, ipAddress: null, userAgent: null });
  return rows.length;
}

// ---------- location reports ----------

const Point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKph: z.number().min(0).max(400).nullable().optional(),
  headingDeg: z.number().min(0).max(360).nullable().optional(),
  altitudeM: z.number().min(-1000).max(10000).nullable().optional(),
  accuracyM: z.number().min(0).max(100000).nullable().optional(),
  recordedAt: z.coerce.date()
});

export const DriverReportSchema = z.object({
  points: z.array(Point).max(500).default([]),
  battery: z.object({ pct: z.number().int().min(0).max(100), charging: z.boolean().optional() }).optional(),
  permission: z.enum(["always", "while_using", "off"]).optional(),
  locationEnabled: z.boolean().optional(),
  appVersion: z.string().max(40).optional(),
  platform: z.enum(["ios", "android", "web"]).optional()
});
export type DriverReport = z.infer<typeof DriverReportSchema>;

/** Points worse than this are dropped (a phone with no GPS lock guesses from cell towers). */
const MAX_ACCURACY_M = 200;

/**
 * Stores the phone's points (oldest first) through the tracker pipeline and updates the phone's
 * status (battery, permission). Queued points from a dead zone are accepted (history only when older
 * than the current position).
 */
export async function recordDriverReport(auth: DriverAuth, report: DriverReport, now = new Date()): Promise<{ stored: number }> {
  const db = getDb();
  const [driver] = await db.select({ id: schema.drivers.id, phoneDeviceId: schema.drivers.phoneDeviceId, vehicleId: schema.drivers.vehicleId, name: schema.drivers.name }).from(schema.drivers).where(eq(schema.drivers.id, auth.driverId));
  if (!driver) throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  const deviceId = driver.phoneDeviceId ?? (await db.transaction((tx) => ensurePhoneDevice(tx, driver.id, auth.organizationId, driver.name)));
  await syncPhoneAssignment(auth.organizationId, deviceId, driver.vehicleId, now);

  const points = [...report.points].filter((p) => p.recordedAt.getTime() <= now.getTime() + 120_000 && (p.accuracyM ?? 0) <= MAX_ACCURACY_M).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  let stored = 0;
  let lastFix: Date | null = null;
  for (const p of points) {
    const pos: NormalizedPosition = {
      externalDeviceId: phoneExternalId(driver.id),
      imei: null,
      latitude: p.latitude,
      longitude: p.longitude,
      speedKph: p.speedKph ?? null,
      headingDeg: p.headingDeg ?? null,
      altitudeM: p.altitudeM ?? null,
      recordedAt: p.recordedAt,
      valid: true,
      ignition: null,
      motion: p.speedKph !== null && p.speedKph !== undefined ? p.speedKph >= 5 : null
    };
    const outcome = await ingestPosition(pos, { now });
    if (outcome.status === "stored") {
      stored++;
      lastFix = p.recordedAt;
      if (outcome.currentUpdated) await afterStoredPosition({ id: outcome.deviceId, organizationId: outcome.organizationId }, pos, p.accuracyM ?? null);
    }
  }
  await db
    .insert(schema.driverAppStatus)
    .values({
      driverId: driver.id,
      organizationId: auth.organizationId,
      signedIn: true,
      batteryPct: report.battery?.pct ?? null,
      charging: report.battery?.charging ?? null,
      permission: report.permission ?? null,
      locationEnabled: report.locationEnabled ?? null,
      platform: report.platform ?? null,
      appVersion: report.appVersion ?? null,
      lastReportAt: now,
      lastFixAt: lastFix
    })
    .onConflictDoUpdate({
      target: schema.driverAppStatus.driverId,
      set: {
        signedIn: true,
        lastReportAt: now,
        updatedAt: now,
        ...(report.battery ? { batteryPct: report.battery.pct, charging: report.battery.charging ?? null } : {}),
        ...(report.permission ? { permission: report.permission } : {}),
        ...(report.locationEnabled !== undefined ? { locationEnabled: report.locationEnabled } : {}),
        ...(report.platform ? { platform: report.platform } : {}),
        ...(report.appVersion ? { appVersion: report.appVersion } : {}),
        ...(lastFix ? { lastFixAt: sql`greatest(${schema.driverAppStatus.lastFixAt}, ${lastFix.toISOString()}::timestamptz)` } : {})
      }
    });
  return { stored };
}

/**
 * Tracker first: the phone stands for the driver's truck only when that truck has no tracker of its
 * own. Otherwise (or with no truck) the phone is unassigned and shows as the driver.
 */
async function syncPhoneAssignment(organizationId: string, phoneDeviceId: string, vehicleId: string | null, now: Date): Promise<void> {
  const db = getDb();
  let target: string | null = null;
  if (vehicleId) {
    const [tracker] = await db
      .select({ id: schema.deviceAssignments.id })
      .from(schema.deviceAssignments)
      .innerJoin(schema.gpsDevices, eq(schema.gpsDevices.id, schema.deviceAssignments.deviceId))
      .where(and(eq(schema.deviceAssignments.vehicleId, vehicleId), eq(schema.deviceAssignments.organizationId, organizationId), isNull(schema.deviceAssignments.unassignedAt), eq(schema.gpsDevices.kind, "tracker"), eq(schema.gpsDevices.status, "active")))
      .limit(1);
    if (!tracker) target = vehicleId;
  }
  const [current] = await db
    .select({ id: schema.deviceAssignments.id, vehicleId: schema.deviceAssignments.vehicleId })
    .from(schema.deviceAssignments)
    .where(and(eq(schema.deviceAssignments.deviceId, phoneDeviceId), eq(schema.deviceAssignments.organizationId, organizationId), isNull(schema.deviceAssignments.unassignedAt)))
    .limit(1);
  if ((current?.vehicleId ?? null) === target) return;
  await db.transaction(async (tx) => {
    if (current) await tx.update(schema.deviceAssignments).set({ unassignedAt: now }).where(eq(schema.deviceAssignments.id, current.id));
    if (target) await tx.insert(schema.deviceAssignments).values({ organizationId, deviceId: phoneDeviceId, vehicleId: target, assignedAt: now });
  });
}

// ---------- what the driver app shows ----------

export interface DriverMeDto {
  driver: { id: string; name: string; phone: string | null };
  company: { id: string; name: string; phone: string | null };
  vehicle: { id: string; name: string; licensePlate: string | null } | null;
  sharing: { always: true; note: string };
}

export async function driverMe(auth: DriverAuth): Promise<DriverMeDto> {
  const db = getDb();
  const [r] = await db
    .select({ id: schema.drivers.id, name: schema.drivers.name, phone: schema.drivers.phone, orgId: schema.organizations.id, orgName: schema.organizations.name, orgPhone: schema.organizations.contactPhone, vId: schema.vehicles.id, vName: schema.vehicles.name, vPlate: schema.vehicles.licensePlate })
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.vehicleId))
    .where(eq(schema.drivers.id, auth.driverId));
  if (!r) throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  return {
    driver: { id: r.id, name: r.name, phone: r.phone },
    company: { id: r.orgId, name: r.orgName, phone: r.orgPhone },
    vehicle: r.vId ? { id: r.vId, name: r.vName!, licensePlate: r.vPlate } : null,
    sharing: { always: true, note: `${r.orgName} sees your location while you're signed in.` }
  };
}

// ---------- what the carrier sees ----------

export type DriverAppState = "sharing" | "stale" | "location_off" | "signed_out" | "no_app";

export interface DriverAppStatusDto {
  driverId: string;
  state: DriverAppState;
  batteryPct: number | null;
  charging: boolean | null;
  permission: string | null;
  platform: string | null;
  appVersion: string | null;
  lastReportAt: string | null;
  lastFixAt: string | null;
  phoneDeviceId: string | null;
  inviteSentAt: string | null;
}

/** A phone that hasn't reported for this long is "stale" (asleep, no signal, app killed). */
const STALE_MS = 30 * 60_000;

export function appState(row: { signedIn: boolean | null; permission: string | null; locationEnabled: boolean | null; lastReportAt: Date | null } | null, now = Date.now()): DriverAppState {
  if (!row) return "no_app";
  if (!row.signedIn) return "signed_out";
  if (row.permission === "off" || row.locationEnabled === false) return "location_off";
  if (!row.lastReportAt || now - row.lastReportAt.getTime() > STALE_MS) return "stale";
  return "sharing";
}

export async function listDriverAppStatus(organizationId: string, driverIds?: string[]): Promise<DriverAppStatusDto[]> {
  const db = getDb();
  const where = driverIds?.length ? and(eq(schema.drivers.organizationId, organizationId), inArray(schema.drivers.id, driverIds)) : eq(schema.drivers.organizationId, organizationId);
  const rows = await db
    .select({
      driverId: schema.drivers.id,
      phoneDeviceId: schema.drivers.phoneDeviceId,
      signedIn: schema.driverAppStatus.signedIn,
      permission: schema.driverAppStatus.permission,
      locationEnabled: schema.driverAppStatus.locationEnabled,
      batteryPct: schema.driverAppStatus.batteryPct,
      charging: schema.driverAppStatus.charging,
      platform: schema.driverAppStatus.platform,
      appVersion: schema.driverAppStatus.appVersion,
      lastReportAt: schema.driverAppStatus.lastReportAt,
      lastFixAt: schema.driverAppStatus.lastFixAt,
      inviteSentAt: sql<Date | null>`(select max(i.created_at) from driver_invites i where i.driver_id = ${schema.drivers.id})`
    })
    .from(schema.drivers)
    .leftJoin(schema.driverAppStatus, eq(schema.driverAppStatus.driverId, schema.drivers.id))
    .where(where);
  const now = Date.now();
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => ({
    driverId: r.driverId,
    state: appState(r.signedIn === null ? null : { signedIn: r.signedIn, permission: r.permission, locationEnabled: r.locationEnabled, lastReportAt: r.lastReportAt }, now),
    batteryPct: r.batteryPct,
    charging: r.charging,
    permission: r.permission,
    platform: r.platform,
    appVersion: r.appVersion,
    lastReportAt: iso(r.lastReportAt),
    lastFixAt: iso(r.lastFixAt),
    phoneDeviceId: r.phoneDeviceId,
    inviteSentAt: iso(r.inviteSentAt)
  }));
}
