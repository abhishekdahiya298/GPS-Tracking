import { addDays, canonicalTimeZone, dateFormatter } from "@rio-gps/core/timezones";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { DriverAuth } from "./driver-app";
import { logger } from "./logger";
import { sendPushMessages } from "./push";
import { NotFoundError, UnauthenticatedError as UnauthorizedError, ValidationError } from "./errors";

/**
 * Driver-first links. Anyone can be a driver with their phone number; each company that works
 * with them has its own driver row (same phone). A company adds the number and the driver accepts
 * in the app (app_link: pending → active), declines, or later leaves. Location from the app goes
 * only to companies the driver accepted. The driver's own profile (name, email, licence) is kept
 * the same on every company's row.
 */

export type AppLink = "pending" | "active" | "declined" | "left";

const linkedCols = {
  id: schema.drivers.id,
  organizationId: schema.drivers.organizationId,
  orgName: schema.organizations.name,
  orgPhone: schema.organizations.contactPhone,
  appLink: schema.drivers.appLink,
  appLinkAt: schema.drivers.appLinkAt,
  createdAt: schema.drivers.createdAt,
  phoneDeviceId: schema.drivers.phoneDeviceId,
  vehicleName: schema.vehicles.name,
  vehiclePlate: schema.vehicles.licensePlate
};

async function myPhone(auth: DriverAuth): Promise<string | null> {
  const [d] = await getDb().select({ phone: schema.drivers.phone }).from(schema.drivers).where(eq(schema.drivers.id, auth.driverId));
  if (!d) throw new UnauthorizedError("Your sign-in has ended. Sign in again.");
  return d.phone;
}

/** Every company row for this driver's phone (active employment, active company). */
async function linkedRows(auth: DriverAuth) {
  const phone = await myPhone(auth);
  return getDb()
    .select(linkedCols)
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.vehicleId))
    .where(and(phone ? eq(schema.drivers.phone, phone) : eq(schema.drivers.id, auth.driverId), eq(schema.drivers.status, "active"), eq(schema.organizations.status, "active")))
    .orderBy(schema.drivers.createdAt);
}

export interface DriverRequestDto {
  id: string;
  company: { id: string; name: string; phone: string | null };
  askedAt: string;
}

export interface DriverCompanyDto {
  /** The driver row at that company (use it to leave). */
  id: string;
  company: { id: string; name: string; phone: string | null };
  link: AppLink;
  since: string;
  vehicle: { name: string; licensePlate: string | null } | null;
  /** The company this sign-in belongs to. */
  current: boolean;
}

export async function driverRequests(auth: DriverAuth): Promise<DriverRequestDto[]> {
  return (await linkedRows(auth))
    .filter((r) => r.appLink === "pending")
    .map((r) => ({ id: r.id, company: { id: r.organizationId, name: r.orgName, phone: r.orgPhone }, askedAt: (r.appLinkAt ?? r.createdAt).toISOString() }));
}

export async function driverCompanies(auth: DriverAuth): Promise<DriverCompanyDto[]> {
  return (await linkedRows(auth))
    .filter((r) => r.appLink === "active" || (r.id === auth.driverId && r.appLink !== "self"))
    .map((r) => ({
      id: r.id,
      company: { id: r.organizationId, name: r.orgName, phone: r.orgPhone },
      link: r.appLink as AppLink,
      since: (r.appLinkAt ?? r.createdAt).toISOString(),
      vehicle: r.vehicleName ? { name: r.vehicleName, licensePlate: r.vehiclePlate } : null,
      current: r.id === auth.driverId
    }));
}

async function ownRow(auth: DriverAuth, rowId: string) {
  const row = (await linkedRows(auth)).find((r) => r.id === rowId);
  if (!row) throw new NotFoundError("That company isn't in your list");
  return row;
}

export const RespondSchema = z.object({ accept: z.boolean() });

/** The driver says yes or no to a company that added their number. */
export async function respondToRequest(auth: DriverAuth, rowId: string, accept: boolean): Promise<{ companies: DriverCompanyDto[]; requests: DriverRequestDto[] }> {
  const row = await ownRow(auth, rowId);
  if (row.appLink !== "pending") throw new ValidationError(row.appLink === "active" ? "You already work with this company." : "This request is no longer open.");
  const link: AppLink = accept ? "active" : "declined";
  await getDb().update(schema.drivers).set({ appLink: link, appLinkAt: new Date(), updatedAt: new Date() }).where(eq(schema.drivers.id, row.id));
  await writeAudit({ action: accept ? "driver.request_accepted" : "driver.request_declined", actorUserId: null, organizationId: row.organizationId, targetType: "driver", targetId: row.id, metadata: {}, ipAddress: null, userAgent: null });
  return { companies: await driverCompanies(auth), requests: await driverRequests(auth) };
}

/**
 * The driver stops working with a company: it stops getting their location. When that company is
 * the one this sign-in belongs to, the sign-in moves to another company the driver works for, or
 * ends when there is none.
 */
export async function leaveCompany(auth: DriverAuth, rowId: string): Promise<{ signedOut: boolean; movedTo: { id: string; name: string } | null }> {
  const row = await ownRow(auth, rowId);
  if (row.appLink !== "active" && row.id !== auth.driverId) throw new ValidationError("You don't work with this company.");
  const db = getDb();
  const now = new Date();
  await db.update(schema.drivers).set({ appLink: "left", appLinkAt: now, updatedAt: now }).where(eq(schema.drivers.id, row.id));
  // The company stops seeing this phone: off its live map and out of its trucks.
  if (row.phoneDeviceId) await db.update(schema.deviceAssignments).set({ unassignedAt: now }).where(and(eq(schema.deviceAssignments.deviceId, row.phoneDeviceId), isNull(schema.deviceAssignments.unassignedAt)));
  await db.update(schema.driverAppStatus).set({ signedIn: false, updatedAt: now }).where(eq(schema.driverAppStatus.driverId, row.id));
  await writeAudit({ action: "driver.left_company", actorUserId: null, organizationId: row.organizationId, targetType: "driver", targetId: row.id, metadata: {}, ipAddress: null, userAgent: null });
  if (row.id !== auth.driverId) return { signedOut: false, movedTo: null };
  const next = (await linkedRows(auth)).find((r) => r.appLink === "active" && r.id !== row.id);
  if (!next) {
    await db.update(schema.driverAppSessions).set({ revokedAt: now }).where(eq(schema.driverAppSessions.id, auth.sessionId));
    return { signedOut: true, movedTo: null };
  }
  await db.update(schema.driverAppSessions).set({ driverId: next.id, organizationId: next.organizationId }).where(eq(schema.driverAppSessions.id, auth.sessionId));
  return { signedOut: false, movedTo: { id: next.organizationId, name: next.orgName } };
}

export const ProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120).optional(),
    email: z
      .string()
      .trim()
      .max(200)
      .transform((s) => (s === "" ? null : s.toLowerCase()))
      .pipe(z.string().email("Enter a valid email").nullable())
      .optional(),
    licenseNumber: z
      .string()
      .trim()
      .max(60)
      .transform((s) => (s === "" ? null : s))
      .optional(),
    licenseExpiresOn: z
      .string()
      .trim()
      .transform((s) => (s === "" ? null : s))
      .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-05-31").nullable())
      .optional()
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** The driver edits their own profile; every company they work with (or that asked) sees the change. */
export async function updateDriverProfile(auth: DriverAuth, patch: z.infer<typeof ProfileSchema>): Promise<void> {
  const rows = (await linkedRows(auth)).filter((r) => r.appLink === "active" || r.appLink === "pending" || r.id === auth.driverId);
  const ids = rows.map((r) => r.id);
  if (!ids.length) ids.push(auth.driverId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "email", "licenseNumber", "licenseExpiresOn"] as const) if (patch[k] !== undefined) set[k] = patch[k];
  await getDb().update(schema.drivers).set(set).where(inArray(schema.drivers.id, ids));
  await writeAudit({ action: "driver.profile_updated", actorUserId: null, organizationId: auth.organizationId, targetType: "driver", targetId: auth.driverId, metadata: { fields: Object.keys(patch), companies: ids.length }, ipAddress: null, userAgent: null });
}

// ---------- the driver's record (driving stats) ----------

export const STATS_RANGES = ["today", "week", "month"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export interface DriverStatsDto {
  range: StatsRange;
  from: string;
  to: string;
  timeZone: string;
  totals: { distanceKm: number; drivingMin: number; idleMin: number; trips: number; maxSpeedKph: number | null; daysDriven: number };
  /** One entry per day in the range, oldest first. */
  days: { day: string; distanceKm: number; drivingMin: number }[];
  byCompany: { company: { id: string; name: string }; distanceKm: number; drivingMin: number; trips: number }[];
  /** When the newest numbers were worked out (they refresh every few minutes). */
  updatedAt: string | null;
}

/**
 * How much the driver drove: from the daily summaries of their phone at each company. The same
 * phone reports to every company the driver accepted, so totals take each day once (the largest
 * company figure), while the per-company split shows each company's share.
 */
export async function driverStats(auth: DriverAuth, range: StatsRange, now = new Date()): Promise<DriverStatsDto> {
  const db = getDb();
  const rows = await linkedRows(auth);
  const [org] = await db.select({ tz: schema.organizations.timeZone }).from(schema.organizations).where(eq(schema.organizations.id, auth.organizationId));
  const timeZone = canonicalTimeZone(org?.tz ?? "UTC") ?? "UTC";
  const today = dateFormatter(timeZone).dayKey(now);
  const span = range === "today" ? 1 : range === "week" ? 7 : 30;
  const first = addDays(today, -(span - 1));
  const devices = rows.filter((r) => r.phoneDeviceId && (r.appLink === "active" || r.appLink === "left" || r.id === auth.driverId));
  const t = schema.deviceDailyStats;
  const stats = devices.length
    ? await db
        .select({ deviceId: t.deviceId, organizationId: t.organizationId, day: t.day, distanceM: t.distanceM, drivingS: t.drivingS, idleS: t.idleS, trips: t.trips, maxSpeedKph: t.maxSpeedKph, computedAt: t.computedAt })
        .from(t)
        .where(and(inArray(t.deviceId, devices.map((d) => d.phoneDeviceId!)), gte(t.day, first), lte(t.day, today)))
    : [];
  const perDay = new Map<string, (typeof stats)[number]>();
  for (const s of stats) {
    const cur = perDay.get(s.day);
    if (!cur || Number(s.distanceM) > Number(cur.distanceM)) perDay.set(s.day, s);
  }
  const days = Array.from({ length: span }, (_, i) => {
    const day = addDays(first, i);
    const s = perDay.get(day);
    return { day, distanceKm: s ? Math.round(Number(s.distanceM) / 100) / 10 : 0, drivingMin: s ? Math.round(Number(s.drivingS) / 60) : 0 };
  });
  const pd = [...perDay.values()];
  const max = pd.reduce<number | null>((m, s) => (s.maxSpeedKph == null ? m : Math.max(m ?? 0, Number(s.maxSpeedKph))), null);
  const names = new Map(rows.map((r) => [r.organizationId, r.orgName]));
  const byOrg = new Map<string, { distanceM: number; drivingS: number; trips: number }>();
  for (const s of stats) {
    const o = byOrg.get(s.organizationId) ?? { distanceM: 0, drivingS: 0, trips: 0 };
    o.distanceM += Number(s.distanceM);
    o.drivingS += Number(s.drivingS);
    o.trips += Number(s.trips);
    byOrg.set(s.organizationId, o);
  }
  const updated = stats.reduce<Date | null>((m, s) => (!m || s.computedAt > m ? s.computedAt : m), null);
  return {
    range,
    from: first,
    to: today,
    timeZone,
    totals: {
      distanceKm: Math.round(pd.reduce((a, s) => a + Number(s.distanceM), 0) / 100) / 10,
      drivingMin: Math.round(pd.reduce((a, s) => a + Number(s.drivingS), 0) / 60),
      idleMin: Math.round(pd.reduce((a, s) => a + Number(s.idleS), 0) / 60),
      trips: pd.reduce((a, s) => a + Number(s.trips), 0),
      maxSpeedKph: max == null ? null : Math.round(max),
      daysDriven: pd.filter((s) => Number(s.distanceM) > 0).length
    },
    days,
    byCompany: [...byOrg.entries()].map(([id, o]) => ({ company: { id, name: names.get(id) ?? "Company" }, distanceKm: Math.round(o.distanceM / 100) / 10, drivingMin: Math.round(o.drivingS / 60), trips: o.trips })),
    updatedAt: updated ? updated.toISOString() : null
  };
}

// ---------- carrier side ----------

/** The carrier asks again (after a decline or a leave, or to re-send). */
export async function requestDriverAgain(organizationId: string, driverId: string, actorUserId: string): Promise<AppLink> {
  const db = getDb();
  const [d] = await db.select({ id: schema.drivers.id, appLink: schema.drivers.appLink, phone: schema.drivers.phone }).from(schema.drivers).where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.organizationId, organizationId)));
  if (!d) throw new NotFoundError("Driver not found");
  if (!d.phone) throw new ValidationError("Add the driver's mobile number first.");
  if (d.appLink === "active") return "active";
  await db.update(schema.drivers).set({ appLink: "pending", appLinkAt: new Date(), updatedAt: new Date() }).where(eq(schema.drivers.id, d.id));
  await writeAudit({ action: "driver.request_sent", actorUserId, organizationId, targetType: "driver", targetId: d.id, metadata: { previous: d.appLink }, ipAddress: null, userAgent: null });
  await notifyDriverRequest(organizationId, d.phone);
  return "pending";
}

/**
 * A company added (or asked again for) this phone number: if the driver already has the app on
 * any company, their phone gets a notification to accept or decline. Best effort.
 */
export async function notifyDriverRequest(organizationId: string, phone: string | null): Promise<number> {
  if (!phone) return 0;
  try {
    const db = getDb();
    const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
    const rows = await db
      .select({ token: schema.driverAppSessions.pushToken })
      .from(schema.driverAppSessions)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverAppSessions.driverId))
      .where(and(eq(schema.drivers.phone, phone), isNull(schema.driverAppSessions.revokedAt), isNotNull(schema.driverAppSessions.pushToken)));
    const tokens = [...new Set(rows.map((r) => r.token!).filter(Boolean))];
    if (!tokens.length) return 0;
    const { sent } = await sendPushMessages(tokens.map((to) => ({ to, title: `${org?.name ?? "A company"} wants to add you`, body: "Open RIO GPS to accept or decline. They see your location only if you accept.", data: { type: "driver_request" }, sound: "default" as const, channelId: "alerts" })));
    return sent;
  } catch (err) {
    logger.error("driver_links.notify_failed", { organizationId }, err);
    return 0;
  }
}

/**
 * A company made its driver inactive or removed them. The driver keeps their own account and
 * record: each phone signed in through that company moves to another company the driver works
 * for, or to their own account, and gets a notice. The company stops getting the location.
 */
export async function releaseDriverFromCompany(organizationId: string, driverId: string): Promise<number> {
  const db = getDb();
  const [d] = await db.select({ id: schema.drivers.id, phone: schema.drivers.phone, name: schema.drivers.name, orgName: schema.organizations.name }).from(schema.drivers).innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId)).where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.organizationId, organizationId)));
  if (!d) return 0;
  const sessions = await db.select({ id: schema.driverAppSessions.id, pushToken: schema.driverAppSessions.pushToken }).from(schema.driverAppSessions).where(and(eq(schema.driverAppSessions.driverId, d.id), isNull(schema.driverAppSessions.revokedAt)));
  if (!sessions.length) return 0;
  if (!d.phone) {
    await db.update(schema.driverAppSessions).set({ revokedAt: new Date() }).where(inArray(schema.driverAppSessions.id, sessions.map((s) => s.id)));
    return 0;
  }
  const [other] = await db
    .select({ id: schema.drivers.id, organizationId: schema.drivers.organizationId })
    .from(schema.drivers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.drivers.organizationId))
    .where(and(eq(schema.drivers.phone, d.phone), eq(schema.drivers.status, "active"), eq(schema.organizations.status, "active"), eq(schema.drivers.appLink, "active"), sql`${schema.drivers.id} <> ${d.id}`))
    .limit(1);
  const { createSelfDriver, driversOrgId } = await import("./driver-loads");
  const target = other ?? { id: await createSelfDriver(d.phone, d.name), organizationId: await driversOrgId() };
  await db.update(schema.driverAppSessions).set({ driverId: target.id, organizationId: target.organizationId }).where(inArray(schema.driverAppSessions.id, sessions.map((s) => s.id)));
  await db.update(schema.driverAppStatus).set({ signedIn: false, updatedAt: new Date() }).where(eq(schema.driverAppStatus.driverId, d.id));
  const tokens = [...new Set(sessions.map((s) => s.pushToken).filter((t): t is string => Boolean(t)))];
  if (tokens.length)
    await sendPushMessages(tokens.map((to) => ({ to, title: `${d.orgName} removed you`, body: "They no longer see your location. Your account and record stay with you.", data: { type: "driver_removed", company: d.orgName }, sound: "default" as const, channelId: "alerts" }))).catch(() => undefined);
  await writeAudit({ action: "driver.released", actorUserId: null, organizationId, targetType: "driver", targetId: d.id, metadata: { movedTo: other ? "company" : "own_account" }, ipAddress: null, userAgent: null });
  return sessions.length;
}
