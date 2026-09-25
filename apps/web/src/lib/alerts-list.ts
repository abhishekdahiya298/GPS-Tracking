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
  tz: z
    .string()
    .max(64)
    .refine((t) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: t });
        return true;
      } catch {
        return false;
      }
    })
    .default("UTC")
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

/** UTC instant of local midnight for a YYYY-MM-DD day in time zone tz. */
function dayStart(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t);
}

export async function listAlertsPage(organizationId: string, q: AlertListQuery): Promise<AlertPage> {
  const e = schema.alertEvents;
  const v = schema.vehicles;
  const base: SQL[] = [eq(e.organizationId, organizationId)];
  if (q.type !== "all") base.push(eq(e.type, q.type));
  if (q.search) {
    const p = likePattern(q.search);
    base.push(or(ilike(e.ruleName, p), ilike(v.name, p))!);
  }
  if (q.from) base.push(gte(e.occurredAt, dayStart(q.from, q.tz)));
  if (q.to) {
    const next = new Date(dayStart(q.to, q.tz).getTime() + 36 * 3600_000); // a day later, then snap to local midnight
    base.push(lt(e.occurredAt, dayStart(new Intl.DateTimeFormat("en-CA", { timeZone: q.tz }).format(next), q.tz)));
  }
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
