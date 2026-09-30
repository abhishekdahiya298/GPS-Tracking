import { addDays, canonicalTimeZone, isValidTimeZone, startOfLocalDay } from "@rio-gps/core/timezones";
import { ALERT_TYPES } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AlertEventDto } from "./alerts";
import { PAGE_SIZES } from "./fleet-list";

/**
 * Paged, filtered alert history for the Alerts page. Everything happens in SQL,
 * scoped to the caller's organization; the browser gets one page at a time.
 */
export const AlertListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(25),
  status: z.enum(["all", "unack", "ack"]).default("all"),
  type: z.enum(["all", ...ALERT_TYPES]).default("all"),
  search: z.string().trim().max(100).default(""),
  /** Local calendar days (YYYY-MM-DD) interpreted in `tz`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Optional; callers fill in the viewer's effective zone when absent. */
  tz: z.string().max(64).refine(isValidTimeZone).optional()
});
export type AlertListQuery = z.infer<typeof AlertListQuery>;

export interface AlertPage {
  items: AlertEventDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; unack: number };
}

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** `defaultTz`: the viewer's effective zone, used for the day filters when the query has none. */
export async function listAlertsPage(organizationId: string, q: AlertListQuery, defaultTz = "UTC"): Promise<AlertPage> {
  const tz = canonicalTimeZone(q.tz ?? defaultTz) ?? "UTC";
  const e = schema.alertEvents;
  const v = schema.vehicles;
  const base: SQL[] = [eq(e.organizationId, organizationId)];
  if (q.type !== "all") base.push(eq(e.type, q.type));
  if (q.search) {
    const p = likePattern(q.search);
    base.push(or(ilike(e.ruleName, p), ilike(v.name, p))!);
  }
  if (q.from) base.push(gte(e.occurredAt, startOfLocalDay(q.from, tz)));
  if (q.to) base.push(lt(e.occurredAt, startOfLocalDay(addDays(q.to, 1), tz)));
  const status = q.status === "unack" ? [isNull(e.acknowledgedAt)] : q.status === "ack" ? [isNotNull(e.acknowledgedAt)] : [];
  const db = getDb();
  const join = and(eq(v.id, e.vehicleId), eq(v.organizationId, organizationId));

  const [rows, [tot], [allCount], [unackCount]] = await Promise.all([
    db
      .select({ ev: e, vehicleName: v.name })
      .from(e)
      .leftJoin(v, join)
      .where(and(...base, ...status))
      .orderBy(desc(e.occurredAt), desc(e.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(e).leftJoin(v, join).where(and(...base, ...status)),
    db.select({ n: count() }).from(e).leftJoin(v, join).where(and(...base)),
    db.select({ n: count() }).from(e).leftJoin(v, join).where(and(...base, isNull(e.acknowledgedAt)))
  ]);
  return {
    items: rows.map(({ ev, vehicleName }) => ({
      id: ev.id,
      type: ev.type,
      ruleName: ev.ruleName,
      deviceId: ev.deviceId,
      vehicleId: ev.vehicleId,
      vehicleName,
      occurredAt: ev.occurredAt.toISOString(),
      latitude: ev.latitude,
      longitude: ev.longitude,
      details: ev.details,
      acknowledgedAt: ev.acknowledgedAt?.toISOString() ?? null
    })),
    total: tot?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    counts: { all: allCount?.n ?? 0, unack: unackCount?.n ?? 0 }
  };
}
