import type { NormalizedPosition, TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "./audit";
import { getServerEnv } from "./env";
import { ForbiddenError, NotFoundError, TooManyRequestsError, UnauthenticatedError as UnauthorizedError, ValidationError } from "./errors";
import { ingestPosition } from "./ingest";
import { afterStoredPosition } from "./ingest-pipeline";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import { assertRateLimit } from "./rate-limit";
import { checkDriverSignInCode, sendDriverSignInCode } from "./signup";
import { getPlatformSettings } from "./platform-settings";
import { sendPushMessages } from "./push";
import { smsConfigured } from "./sms";

/**
 * The driver app. A driver signs in with a personal invite link (works today) or with their phone
 * number and a text code (when texts work). While signed in, the phone shares its location all the
 * time: every point goes through the same pipeline as a hardware tracker (history, trips, alerts,
 * loads, live map), as a gps_devices row of kind "phone". Tracker first: the phone is the truck's
 * position only when the truck has no tracker of its own.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

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
  const expiresAt = new Date(Date.now() + (await getPlatformSettings()).driverInviteDays * 86_400_000);
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
  const tokens = await openPushTokens(organizationId, driverId);
  const rows = await db
    .update(schema.driverAppSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.driverAppSessions.driverId, driverId), eq(schema.driverAppSessions.organizationId, organizationId), isNull(schema.driverAppSessions.revokedAt)))
    .returning({ id: schema.driverAppSessions.id });
  await db.update(schema.driverAppStatus).set({ signedIn: false, updatedAt: new Date() }).where(eq(schema.driverAppStatus.driverId, driverId));
  if (rows.length) await writeAudit({ action: "driver.app_signed_out_by_company", actorUserId, organizationId, targetType: "driver", targetId: driverId, metadata: { sessions: rows.length }, ipAddress: null, userAgent: null });
  // The phone shows "You're signed out" (D15) even before the app next talks to the server.
  if (tokens.length) await sendPushMessages(tokens.map((to) => ({ to, title: "You're signed out", body: "Your company signed you out of RIO GPS. Location sharing has stopped.", data: { type: "driver_signed_out" }, sound: "default" as const, channelId: "alerts" })));
  return rows.length;
}

// ---------- push to the driver's phone ----------

async function openPushTokens(organizationId: string, driverId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ token: schema.driverAppSessions.pushToken })
    .from(schema.driverAppSessions)
    .where(and(eq(schema.driverAppSessions.driverId, driverId), eq(schema.driverAppSessions.organizationId, organizationId), isNull(schema.driverAppSessions.revokedAt), isNotNull(schema.driverAppSessions.pushToken)));
  return [...new Set(rows.map((r) => r.token!).filter(Boolean))];
}

export const PushTokenSchema = z.object({ token: z.string().trim().min(10).max(300).regex(/^(ExponentPushToken|ExpoPushToken)\[.+\]$/, "Not a push address").nullable() });

/** The driver app saves (or clears) this phone's push address for its session. */
export async function setDriverPushToken(auth: DriverAuth, token: string | null): Promise<void> {
  await getDb().update(schema.driverAppSessions).set({ pushToken: token }).where(eq(schema.driverAppSessions.id, auth.sessionId));
}

/** How long the company waits before asking the same driver again. */
export const ASK_LOCATION_EVERY_MS = 15 * 60_000;
export const AskLocationSchema = z.object({ message: z.string().trim().max(240).optional() });

/**
 * "Ask to turn on location" (A10B, O6): a push to the driver's phone with a Turn on button.
 * At most once every 15 minutes per driver; the driver sees who asked.
 */
export async function askDriverLocation(ctx: TenantContext, driverId: string, actor: { userId: string; name: string }, message?: string, now = new Date()): Promise<{ sent: number; askedAt: string; nextAt: string }> {
  const db = getDb();
  const [d] = await db
    .select({ id: schema.drivers.id, name: schema.drivers.name, status: schema.drivers.status, askedAt: schema.driverAppStatus.locationAskedAt, signedIn: schema.driverAppStatus.signedIn })
    .from(schema.drivers)
    .leftJoin(schema.driverAppStatus, eq(schema.driverAppStatus.driverId, schema.drivers.id))
    .where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.organizationId, ctx.organizationId)));
  if (!d) throw new NotFoundError("Driver not found");
  if (d.status !== "active") throw new ValidationError("This driver is inactive.");
  if (!d.signedIn) throw new ValidationError(`${d.name} isn't signed in to the driver app. Send an app invite instead.`);
  if (d.askedAt && now.getTime() - d.askedAt.getTime() < ASK_LOCATION_EVERY_MS) {
    const wait = Math.ceil((ASK_LOCATION_EVERY_MS - (now.getTime() - d.askedAt.getTime())) / 60_000);
    throw new TooManyRequestsError(`You asked recently. You can ask ${d.name} again in ${wait} min.`);
  }
  const tokens = await openPushTokens(ctx.organizationId, driverId);
  if (!tokens.length) throw new ValidationError(`${d.name}'s phone hasn't turned on notifications. Call them instead.`);
  const body = message?.trim() || "Your company can't see your location. Tap to turn it back on.";
  const { sent } = await sendPushMessages(
    tokens.map((to) => ({ to, title: `${actor.name} asks: turn on location`, body, data: { type: "location_request", from: actor.name, message: message?.trim() ?? "", at: now.toISOString() }, sound: "default" as const, channelId: "alerts" }))
  );
  await db.update(schema.driverAppStatus).set({ locationAskedAt: now, locationAskedBy: actor.userId, updatedAt: now }).where(eq(schema.driverAppStatus.driverId, driverId));
  await writeAudit({ action: "driver.location_requested", actorUserId: actor.userId, organizationId: ctx.organizationId, targetType: "driver", targetId: driverId, metadata: { sent, message: message?.trim() ?? null }, ipAddress: null, userAgent: null });
  return { sent, askedAt: now.toISOString(), nextAt: new Date(now.getTime() + ASK_LOCATION_EVERY_MS).toISOString() };
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

  const { driverMaxAccuracyM: maxAccuracyM } = await getPlatformSettings();
  const points = [...report.points].filter((p) => p.recordedAt.getTime() <= now.getTime() + 120_000 && (p.accuracyM ?? 0) <= maxAccuracyM).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
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
  /** The company asked to turn location on in the last hour. */
  locationRequest: { at: string; from: string | null } | null;
}

/** A request from the company in the last hour, shown on D14 when the app opens. */
async function recentLocationRequest(driverId: string): Promise<{ at: string; from: string | null } | null> {
  const [r] = await getDb()
    .select({ at: schema.driverAppStatus.locationAskedAt, from: schema.users.name })
    .from(schema.driverAppStatus)
    .leftJoin(schema.users, eq(schema.users.id, schema.driverAppStatus.locationAskedBy))
    .where(eq(schema.driverAppStatus.driverId, driverId));
  if (!r?.at || Date.now() - r.at.getTime() > 60 * 60_000) return null;
  return { at: r.at.toISOString(), from: r.from ?? null };
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
    sharing: { always: true, note: `${r.orgName} sees your location while you're signed in.` },
    locationRequest: await recentLocationRequest(auth.driverId)
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
  /** The company last asked this driver to turn location on. */
  locationAskedAt: string | null;
  /** The driver's phone can get notifications (needed to ask). */
  canNotify: boolean;
}

/** A phone that hasn't reported for this long is "stale" (asleep, no signal, app killed). */
/** Default "Not heard from" time; Platform settings can change it. */
const STALE_MS = 30 * 60_000;

export function appState(row: { signedIn: boolean | null; permission: string | null; locationEnabled: boolean | null; lastReportAt: Date | null } | null, now = Date.now(), staleMs = STALE_MS): DriverAppState {
  if (!row) return "no_app";
  if (!row.signedIn) return "signed_out";
  if (row.permission === "off" || row.locationEnabled === false) return "location_off";
  if (!row.lastReportAt || now - row.lastReportAt.getTime() > staleMs) return "stale";
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
      inviteSentAt: sql<Date | null>`(select max(i.created_at) from driver_invites i where i.driver_id = ${schema.drivers.id})`,
      locationAskedAt: schema.driverAppStatus.locationAskedAt,
      canNotify: sql<boolean>`exists (select 1 from driver_app_sessions x where x.driver_id = ${schema.drivers.id} and x.revoked_at is null and x.push_token is not null)`
    })
    .from(schema.drivers)
    .leftJoin(schema.driverAppStatus, eq(schema.driverAppStatus.driverId, schema.drivers.id))
    .where(where);
  const now = Date.now();
  const staleMs = (await getPlatformSettings()).driverStaleMinutes * 60_000;
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => ({
    driverId: r.driverId,
    state: appState(r.signedIn === null ? null : { signedIn: r.signedIn, permission: r.permission, locationEnabled: r.locationEnabled, lastReportAt: r.lastReportAt }, now, staleMs),
    batteryPct: r.batteryPct,
    charging: r.charging,
    permission: r.permission,
    platform: r.platform,
    appVersion: r.appVersion,
    lastReportAt: iso(r.lastReportAt),
    lastFixAt: iso(r.lastFixAt),
    phoneDeviceId: r.phoneDeviceId,
    inviteSentAt: iso(r.inviteSentAt),
    locationAskedAt: iso(r.locationAskedAt),
    canNotify: Boolean(r.canNotify)
  }));
}

export interface MapDriverDto {
  id: string;
  name: string;
  phone: string | null;
  vehicle: { id: string; name: string } | null;
  /** The device whose position stands for the driver: the truck's tracker first, else the phone. */
  deviceId: string | null;
  source: "tracker" | "phone" | null;
  app: DriverAppStatusDto;
}

/** Every active driver for the live map's Drivers view (A03): where each one is and their app. */
export async function driversForMap(organizationId: string): Promise<MapDriverDto[]> {
  const rows = await getDb().execute<{ id: string; name: string; phone: string | null; vehicle_id: string | null; vehicle_name: string | null; tracker_id: string | null; tracker_kind: string | null; phone_device_id: string | null }>(sql`
    select d.id, d.name, d.phone, v.id as vehicle_id, v.name as vehicle_name, a.device_id as tracker_id, g.kind as tracker_kind, d.phone_device_id
    from drivers d
    left join vehicles v on v.id = d.vehicle_id and v.organization_id = d.organization_id
    left join device_assignments a on a.vehicle_id = v.id and a.unassigned_at is null and a.organization_id = d.organization_id
    left join gps_devices g on g.id = a.device_id
    where d.organization_id = ${organizationId} and d.status = 'active'
    order by lower(d.name)`);
  const status = new Map((await listDriverAppStatus(organizationId)).map((s) => [s.driverId, s]));
  return rows.map((r) => {
    const app = status.get(r.id)!;
    const tracker = r.tracker_id && r.tracker_kind === "tracker" ? r.tracker_id : null;
    const phoneDev = r.phone_device_id && app.state !== "no_app" ? r.phone_device_id : null;
    // A phone that stands in for a truck without a tracker is that truck's device.
    const deviceId = tracker ?? (r.tracker_id && r.tracker_kind === "phone" ? r.tracker_id : phoneDev);
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      vehicle: r.vehicle_id ? { id: r.vehicle_id, name: r.vehicle_name ?? "" } : null,
      deviceId,
      source: tracker ? "tracker" : deviceId ? "phone" : null,
      app
    };
  });
}

/** What an invite link is for, without using it up (the /driver-app page shows "Join <company>"). */
export async function peekDriverInvite(token: string): Promise<{ state: "ok" | "used" | "expired" | "unknown"; driverName?: string; companyName?: string }> {
  const [r] = await getDb()
    .select({ usedAt: schema.driverInvites.usedAt, expiresAt: schema.driverInvites.expiresAt, driverName: schema.drivers.name, companyName: schema.organizations.name })
    .from(schema.driverInvites)
    .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverInvites.driverId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.driverInvites.organizationId))
    .where(eq(schema.driverInvites.tokenHash, sha(token)));
  if (!r) return { state: "unknown" };
  const who = { driverName: r.driverName, companyName: r.companyName };
  if (r.usedAt) return { state: "used", ...who };
  if (r.expiresAt < new Date()) return { state: "expired", ...who };
  return { state: "ok", ...who };
}

// ---------- the driver's loads (driver app Today / Loads) ----------

export interface DriverLoadDto {
  id: string;
  reference: string;
  status: string;
  notes: string | null;
  pickup: { name: string | null; address: string; lat: number; lon: number; appointmentAt: string | null };
  delivery: { name: string | null; address: string; lat: number; lon: number; appointmentAt: string | null };
  deliveredAt: string | null;
}

/**
 * Loads for this driver: on their truck, or sent to their phone number. Open loads plus those
 * delivered in the last 24 hours, soonest pickup first.
 */
export async function driverLoads(auth: DriverAuth): Promise<DriverLoadDto[]> {
  const db = getDb();
  const [d] = await db.select({ vehicleId: schema.drivers.vehicleId, phone: schema.drivers.phone }).from(schema.drivers).where(eq(schema.drivers.id, auth.driverId));
  if (!d) throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  const phone = d.phone ? normalizePhone(d.phone) : null;
  const rows = await db.execute<{ id: string; reference: string; status: string; notes: string | null; pickup_name: string | null; pickup_address: string; pickup_lat: number; pickup_lon: number; pickup_appointment_at: Date | null; delivery_name: string | null; delivery_address: string; delivery_lat: number; delivery_lon: number; delivery_appointment_at: Date | null; delivered_at: Date | null }>(sql`
    select id, reference, status, notes, pickup_name, pickup_address, pickup_lat, pickup_lon, pickup_appointment_at,
           delivery_name, delivery_address, delivery_lat, delivery_lon, delivery_appointment_at, ended_at as delivered_at
    from loads
    where organization_id = ${auth.organizationId}
      and (${d.vehicleId ? sql`vehicle_id = ${d.vehicleId}` : sql`false`} or ${phone ? sql`driver_phone = ${phone}` : sql`false`})
      and status not in ('cancelled', 'declined')
      and (status <> 'delivered' or ended_at > now() - interval '24 hours')
    order by (status = 'delivered'), coalesce(pickup_appointment_at, created_at)
    limit 50`);
  const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    notes: r.notes,
    pickup: { name: r.pickup_name, address: r.pickup_address, lat: Number(r.pickup_lat), lon: Number(r.pickup_lon), appointmentAt: iso(r.pickup_appointment_at) },
    delivery: { name: r.delivery_name, address: r.delivery_address, lat: Number(r.delivery_lat), lon: Number(r.delivery_lon), appointmentAt: iso(r.delivery_appointment_at) },
    deliveredAt: iso(r.delivered_at)
  }));
}
