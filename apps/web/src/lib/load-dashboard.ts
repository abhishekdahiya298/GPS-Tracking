import { localDay } from "@rio-gps/core";
import { addDays } from "@rio-gps/core/timezones";
import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { needsAttention } from "./load-meta";
import { listLoads, type LoadSummaryDto } from "./loads";

/** Arrived up to this long after the appointment still counts as on time. */
const ON_TIME_GRACE_MIN = 15;

export type LoadAttentionReason = "late" | "no_signal" | "paused";

export interface LoadDashboard {
  active: number;
  counts: { waiting: number; toPickup: number; inTransit: number; atDelivery: number; attention: number };
  /** Late, silent or paused loads, worst first (late by most, then silent, then paused). */
  attention: { load: LoadSummaryDto; reason: LoadAttentionReason }[];
  /** Pickups and deliveries with an appointment today (organization's day), soonest first. */
  today: { load: LoadSummaryDto; stop: "pickup" | "delivery"; at: string }[];
  /** Deliveries per local day, oldest first, zero-filled. */
  delivered: { day: string; count: number }[];
  month: { delivered: number; withAppointment: number; onTime: number };
}

/**
 * Everything the Loads dashboard shows, in one pass: the active loads (already loaded for the
 * Loads list, so the same rules decide "late" and "no signal") plus two small aggregate queries.
 */
export async function getLoadDashboard(organizationId: string, timeZone: string, now = new Date(), days = 14): Promise<LoadDashboard> {
  const today = localDay(now.getTime(), timeZone);
  const firstDay = addDays(today, -(days - 1));
  const monthStart = `${today.slice(0, 7)}-01`;
  const db = getDb();
  const [active, perDay, [month]] = await Promise.all([
    listLoads(organizationId, { filter: "active" }, now),
    db.execute<{ day: string; n: number }>(sql`
      select (ended_at at time zone ${timeZone})::date::text as day, count(*)::int as n
      from loads
      where organization_id = ${organizationId} and status = 'delivered'
        and ended_at >= (${firstDay}::date)::timestamp at time zone ${timeZone}
      group by 1`),
    db.execute<{ delivered: number; with_appt: number; on_time: number }>(sql`
      select count(*)::int as delivered,
        count(*) filter (where l.delivery_appointment_at is not null)::int as with_appt,
        count(*) filter (where l.delivery_appointment_at is not null and arr.at <= l.delivery_appointment_at + make_interval(mins => ${ON_TIME_GRACE_MIN}))::int as on_time
      from loads l
      left join lateral (
        select min(e.at) as at from load_events e where e.load_id = l.id and e.type = 'arrived_delivery'
      ) arr on true
      where l.organization_id = ${organizationId} and l.status = 'delivered'
        and l.ended_at >= (${monthStart}::date)::timestamp at time zone ${timeZone}`)
  ]);

  const reason = (l: LoadSummaryDto): LoadAttentionReason | null => (l.eta?.late ? "late" : l.stale ? "no_signal" : l.sharingStopped ? "paused" : null);
  const attention = active
    .filter((l) => needsAttention(l))
    .map((l) => ({ load: l, reason: reason(l)! }))
    .sort((a, b) => {
      const order = { late: 0, no_signal: 1, paused: 2 } as const;
      return order[a.reason] - order[b.reason] || (b.load.eta?.lateByMinutes ?? 0) - (a.load.eta?.lateByMinutes ?? 0);
    });

  const stops: LoadDashboard["today"] = [];
  for (const l of active) {
    const pickupPending = l.status === "invited" || l.status === "tracking" || l.status === "at_pickup";
    if (pickupPending && l.pickup.appointmentAt && localDay(Date.parse(l.pickup.appointmentAt), timeZone) === today) stops.push({ load: l, stop: "pickup", at: l.pickup.appointmentAt });
    if (l.delivery.appointmentAt && localDay(Date.parse(l.delivery.appointmentAt), timeZone) === today) stops.push({ load: l, stop: "delivery", at: l.delivery.appointmentAt });
  }
  stops.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const byDay = new Map(perDay.map((r) => [r.day, r.n]));
  const delivered = Array.from({ length: days }, (_, i) => {
    const day = addDays(firstDay, i);
    return { day, count: byDay.get(day) ?? 0 };
  });

  return {
    active: active.length,
    counts: {
      waiting: active.filter((l) => l.status === "invited").length,
      toPickup: active.filter((l) => l.status === "tracking" || l.status === "at_pickup").length,
      inTransit: active.filter((l) => l.status === "in_transit").length,
      atDelivery: active.filter((l) => l.status === "at_delivery").length,
      attention: attention.length
    },
    attention,
    today: stops,
    delivered,
    month: { delivered: month?.delivered ?? 0, withAppointment: month?.with_appt ?? 0, onTime: month?.on_time ?? 0 }
  };
}
