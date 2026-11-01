import { MODULES, type Module } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Plans, customer terms and usage. Billing is by manual invoice for now: RIO keeps exact,
 * tamper-proof counts and a monthly statement; payment collection can be added later on top.
 *
 * How usage is counted (also shown to customers on their Plan page, word for word):
 * - A load counts once, in the month it starts tracking (driver accepts the link, or a
 *   vehicle-tracked load is created). Loads cancelled before tracking starts are free.
 *   Deleting or cancelling a load later doesn't remove it from that month.
 * - A tracker counts once for each month it is with the customer (any day of the month).
 * - Months are calendar months in the customer's time zone.
 * - Loads over the monthly allowance never stop: they're billed at the extra-load price.
 */

export const LONG_LOAD_DAYS = 14;
const NEAR_LIMIT = 0.8;

type Meta = { ipAddress: string | null; userAgent: string | null };
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const cents = z.coerce.number().min(0).max(100_000).transform((v) => Math.round(v * 100));
const moduleList = z.array(z.enum(MODULES)).min(1, "Pick at least one module").transform((v) => [...new Set(v)].sort() as Module[]);

/** Prices are entered in dollars and stored in cents. */
export const PlanTermsSchema = z.object({
  modules: moduleList,
  includedLoads: z.coerce.number().int().min(0).max(1_000_000),
  extraLoad: cents,
  monthlyFee: cents,
  perTracker: cents
});

export const PlanInputSchema = PlanTermsSchema.extend({
  name: z.string().trim().min(2).max(60),
  active: z.boolean().default(true)
});

export const SetPlanSchema = PlanTermsSchema.extend({
  planId: z.string().uuid(),
  note: z.string().trim().max(500).optional()
});

export interface PlanTerms {
  modules: Module[];
  includedLoads: number;
  extraLoadCents: number;
  monthlyFeeCents: number;
  perTrackerCents: number;
}
export interface PlanDto extends PlanTerms {
  id: string;
  name: string;
  active: boolean;
  customers: number;
}
export interface SubscriptionDto extends PlanTerms {
  id: string;
  planId: string | null;
  planName: string;
  startedAt: string;
  endedAt: string | null;
  changedByName: string | null;
  note: string | null;
}

const terms = (r: { modules: string[]; includedLoads: number; extraLoadCents: number; monthlyFeeCents: number; perTrackerCents: number }): PlanTerms => ({
  modules: r.modules as Module[],
  includedLoads: r.includedLoads,
  extraLoadCents: r.extraLoadCents,
  monthlyFeeCents: r.monthlyFeeCents,
  perTrackerCents: r.perTrackerCents
});

const isUnique = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

// ---------- catalog ----------

export async function listPlans(): Promise<PlanDto[]> {
  const p = schema.plans;
  const rows = await getDb()
    .select({
      id: p.id,
      name: p.name,
      active: p.active,
      modules: p.modules,
      includedLoads: p.includedLoads,
      extraLoadCents: p.extraLoadCents,
      monthlyFeeCents: p.monthlyFeeCents,
      perTrackerCents: p.perTrackerCents,
      customers: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = "plans"."id" and s.ended_at is null)`
    })
    .from(p)
    .orderBy(desc(p.active), asc(p.sortOrder), asc(p.name));
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, customers: r.customers, ...terms(r) }));
}

function planValues(input: z.infer<typeof PlanInputSchema>) {
  return {
    name: input.name,
    active: input.active,
    modules: input.modules,
    includedLoads: input.modules.includes("loads") ? input.includedLoads : 0,
    extraLoadCents: input.modules.includes("loads") ? input.extraLoad : 0,
    monthlyFeeCents: input.monthlyFee,
    perTrackerCents: input.modules.includes("gps") ? input.perTracker : 0
  };
}

export async function createPlan(actorUserId: string, input: z.infer<typeof PlanInputSchema>, meta: Meta): Promise<{ id: string }> {
  try {
    const [max] = await getDb().select({ n: sql<number>`coalesce(max(${schema.plans.sortOrder}), 0)::int` }).from(schema.plans);
    const [row] = await getDb()
      .insert(schema.plans)
      .values({ ...planValues(input), sortOrder: (max?.n ?? 0) + 1 })
      .returning({ id: schema.plans.id });
    await writeAudit({ action: "plan.created", actorUserId, targetType: "plan", targetId: row!.id, metadata: { name: input.name }, ...meta });
    return row!;
  } catch (err) {
    if (isUnique(err)) throw new ConflictError("A plan with that name already exists");
    throw err;
  }
}

/** Changes the catalog only: customers already on this plan keep the terms they agreed to. */
export async function updatePlan(actorUserId: string, id: string, input: z.infer<typeof PlanInputSchema>, meta: Meta): Promise<void> {
  let updated;
  try {
    [updated] = await getDb()
      .update(schema.plans)
      .set({ ...planValues(input), updatedAt: new Date() })
      .where(eq(schema.plans.id, id))
      .returning({ id: schema.plans.id });
  } catch (err) {
    if (isUnique(err)) throw new ConflictError("A plan with that name already exists");
    throw err;
  }
  if (!updated) throw new NotFoundError("Plan not found");
  await writeAudit({ action: "plan.updated", actorUserId, targetType: "plan", targetId: id, metadata: { name: input.name, active: input.active }, ...meta });
}

// ---------- customer terms ----------

/**
 * The modules a customer's plan includes. `undefined` only for an organization with no plan
 * recorded at all (never the case for customers created in the console; listed on the
 * platform overview so it can be fixed), which is treated as unrestricted.
 */
export async function organizationModules(organizationId: string): Promise<Module[] | undefined> {
  const [row] = await getDb()
    .select({ modules: schema.subscriptions.modules })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.organizationId, organizationId), isNull(schema.subscriptions.endedAt)))
    .limit(1);
  return row ? (row.modules as Module[]) : undefined;
}

export async function customerPlanHistory(organizationId: string): Promise<SubscriptionDto[]> {
  const s = schema.subscriptions;
  const rows = await getDb()
    .select({
      id: s.id,
      planId: s.planId,
      planName: s.planName,
      modules: s.modules,
      includedLoads: s.includedLoads,
      extraLoadCents: s.extraLoadCents,
      monthlyFeeCents: s.monthlyFeeCents,
      perTrackerCents: s.perTrackerCents,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      note: s.note,
      changedByName: schema.users.name
    })
    .from(s)
    .leftJoin(schema.users, eq(schema.users.id, s.changedBy))
    .where(eq(s.organizationId, organizationId))
    .orderBy(desc(s.startedAt));
  return rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    planName: r.planName,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    note: r.note,
    changedByName: r.changedByName ?? null,
    ...terms(r)
  }));
}

/** Starts new terms for a customer (the previous ones end now; history is kept). */
export async function setCustomerPlan(
  actorUserId: string,
  organizationId: string,
  input: z.infer<typeof SetPlanSchema>,
  meta: Meta,
  opts: { tx?: Tx; now?: Date } = {}
): Promise<void> {
  const now = opts.now ?? new Date();
  const run = async (tx: Tx) => {
    const [org] = await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).for("update");
    if (!org) throw new NotFoundError("Customer not found");
    const [plan] = await tx.select({ id: schema.plans.id, name: schema.plans.name }).from(schema.plans).where(eq(schema.plans.id, input.planId));
    if (!plan) throw new ValidationError("Choose a plan");
    await tx
      .update(schema.subscriptions)
      .set({ endedAt: now })
      .where(and(eq(schema.subscriptions.organizationId, organizationId), isNull(schema.subscriptions.endedAt)));
    await tx.insert(schema.subscriptions).values({
      organizationId,
      planId: plan.id,
      planName: plan.name,
      modules: input.modules,
      includedLoads: input.modules.includes("loads") ? input.includedLoads : 0,
      extraLoadCents: input.modules.includes("loads") ? input.extraLoad : 0,
      monthlyFeeCents: input.monthlyFee,
      perTrackerCents: input.modules.includes("gps") ? input.perTracker : 0,
      startedAt: now,
      changedBy: actorUserId,
      note: input.note || null
    });
    return plan.name;
  };
  const planName = opts.tx ? await run(opts.tx) : await getDb().transaction(run);
  await writeAudit({
    action: "customer.plan_changed",
    actorUserId,
    organizationId,
    targetType: "organization",
    targetId: organizationId,
    metadata: { plan: planName, modules: input.modules, includedLoads: input.includedLoads },
    ...meta
  });
}

// ---------- usage ledger ----------

/** "YYYY-MM" of an instant in a time zone. */
export function periodOf(at: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export const PeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-11");

/**
 * Records that a load started tracking (idempotent: a load counts once, ever). Called in the
 * same place the load's tracking starts, so the count can't drift from what really happened.
 */
export async function recordBillableLoad(db: Db | Tx, load: { organizationId: string; id: string; reference: string }, at: Date): Promise<void> {
  await db.execute(sql`
    insert into billable_loads (organization_id, load_id, reference, period, counted_at)
    select o.id, ${load.id}::uuid, ${load.reference}, to_char(${at.toISOString()}::timestamptz at time zone o.time_zone, 'YYYY-MM'), ${at.toISOString()}::timestamptz
    from organizations o where o.id = ${load.organizationId}::uuid
    on conflict (load_id) do nothing`);
}

/** Marks every tracker currently with an active customer as used this month (idempotent). */
export async function recordTrackerMonths(now = new Date()): Promise<number> {
  const rows = await getDb().execute<{ device_id: string }>(sql`
    insert into billable_trackers (organization_id, device_id, imei, period, first_seen_at)
    select d.organization_id, d.id, d.imei, to_char(${now.toISOString()}::timestamptz at time zone o.time_zone, 'YYYY-MM'), ${now.toISOString()}::timestamptz
    from gps_devices d join organizations o on o.id = d.organization_id
    where d.status <> 'retired' and o.status = 'active'
    on conflict do nothing
    returning device_id`);
  return rows.length;
}

/** One tracker, right away (when it's handed to a customer). */
export async function recordTrackerMonth(deviceId: string, now = new Date()): Promise<void> {
  await getDb().execute(sql`
    insert into billable_trackers (organization_id, device_id, imei, period, first_seen_at)
    select d.organization_id, d.id, d.imei, to_char(${now.toISOString()}::timestamptz at time zone o.time_zone, 'YYYY-MM'), ${now.toISOString()}::timestamptz
    from gps_devices d join organizations o on o.id = d.organization_id
    where d.id = ${deviceId}::uuid and d.status <> 'retired' and o.status = 'active'
    on conflict do nothing`);
}

// ---------- statements ----------

export interface UsageLine {
  organizationId: string;
  customerName: string;
  customerStatus: string;
  period: string;
  /** Terms in effect at the end of the month (or now, for the current month). */
  plan: (PlanTerms & { planName: string }) | null;
  loadsUsed: number;
  extraLoads: number;
  trackers: number;
  /** Loads tracked longer than LONG_LOAD_DAYS (worth a look before invoicing). */
  longLoads: number;
  amounts: { monthlyFeeCents: number; trackersCents: number; extraLoadsCents: number; totalCents: number };
}

/** One row per customer (or one customer) for a month. Pure reads; safe to run any time. */
export async function usageStatement(period: string, organizationId?: string, now = new Date()): Promise<UsageLine[]> {
  const rows = await getDb().execute<{
    id: string;
    name: string;
    status: string;
    plan_name: string | null;
    modules: string[] | string | null;
    included_loads: number | null;
    extra_load_cents: number | null;
    monthly_fee_cents: number | null;
    per_tracker_cents: number | null;
    loads_used: number;
    trackers: number;
    long_loads: number;
  }>(sql`
    select o.id, o.name, o.status,
      s.plan_name, s.modules::text[] as modules, s.included_loads, s.extra_load_cents, s.monthly_fee_cents, s.per_tracker_cents,
      (select count(*)::int from billable_loads b where b.organization_id = o.id and b.period = ${period}) as loads_used,
      (select count(*)::int from billable_trackers t where t.organization_id = o.id and t.period = ${period}) as trackers,
      (select count(*)::int from billable_loads b join loads l on l.id = b.load_id
        where b.organization_id = o.id and b.period = ${period} and l.accepted_at is not null
          and coalesce(l.ended_at, ${now.toISOString()}::timestamptz) - l.accepted_at > make_interval(days => ${LONG_LOAD_DAYS})) as long_loads
    from organizations o
    left join lateral (
      select * from subscriptions s where s.organization_id = o.id
        and s.started_at <= least(${now.toISOString()}::timestamptz, ((${period} || '-01')::date + interval '1 month')::timestamp at time zone o.time_zone)
      order by s.started_at desc limit 1
    ) s on true
    where ${organizationId ? sql`o.id = ${organizationId}::uuid` : sql`true`}
    order by lower(o.name)`);
  return rows.map((r) => {
    const modules = (Array.isArray(r.modules) ? r.modules : r.modules ? String(r.modules).replace(/[{}]/g, "").split(",").filter(Boolean) : []) as Module[];
    const plan = r.plan_name
      ? { planName: r.plan_name, modules, includedLoads: r.included_loads ?? 0, extraLoadCents: r.extra_load_cents ?? 0, monthlyFeeCents: r.monthly_fee_cents ?? 0, perTrackerCents: r.per_tracker_cents ?? 0 }
      : null;
    const extraLoads = plan?.modules.includes("loads") ? Math.max(0, r.loads_used - plan.includedLoads) : 0;
    const billedTrackers = plan?.modules.includes("gps") ? r.trackers : 0;
    const monthlyFeeCents = plan?.monthlyFeeCents ?? 0;
    const trackersCents = billedTrackers * (plan?.perTrackerCents ?? 0);
    const extraLoadsCents = extraLoads * (plan?.extraLoadCents ?? 0);
    return {
      organizationId: r.id,
      customerName: r.name,
      customerStatus: r.status,
      period,
      plan,
      loadsUsed: r.loads_used,
      extraLoads,
      trackers: r.trackers,
      longLoads: r.long_loads,
      amounts: { monthlyFeeCents, trackersCents, extraLoadsCents, totalCents: monthlyFeeCents + trackersCents + extraLoadsCents }
    };
  });
}

/** This month's usage for one customer, in their own time zone. */
export async function currentUsage(organizationId: string, now = new Date()): Promise<UsageLine | null> {
  const [org] = await getDb().select({ timeZone: schema.organizations.timeZone }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) return null;
  const [line] = await usageStatement(periodOf(now, org.timeZone), organizationId, now);
  return line ?? null;
}

export type LoadAllowance = { used: number; included: number; extraLoadCents: number; level: "near" | "over" } | null;

/** For the Loads pages: a notice once 80% of the monthly allowance is used. */
export async function loadAllowanceNotice(organizationId: string, now = new Date()): Promise<LoadAllowance> {
  const u = await currentUsage(organizationId, now);
  if (!u?.plan?.modules.includes("loads") || u.plan.includedLoads <= 0) return null;
  const { includedLoads: included, extraLoadCents } = u.plan;
  if (u.loadsUsed >= included) return { used: u.loadsUsed, included, extraLoadCents, level: "over" };
  if (u.loadsUsed >= Math.ceil(included * NEAR_LIMIT)) return { used: u.loadsUsed, included, extraLoadCents, level: "near" };
  return null;
}

export function statementCsv(lines: UsageLine[]): string {
  const money = (c: number) => (c / 100).toFixed(2);
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ["customer", "status", "month", "plan", "trackers", "tracker_price", "loads_used", "loads_included", "extra_loads", "extra_load_price", "monthly_fee", "trackers_amount", "extra_loads_amount", "total", "long_loads"];
  const body = lines.map((l) =>
    [
      l.customerName,
      l.customerStatus,
      l.period,
      l.plan?.planName ?? "",
      l.trackers,
      money(l.plan?.perTrackerCents ?? 0),
      l.loadsUsed,
      l.plan?.includedLoads ?? 0,
      l.extraLoads,
      money(l.plan?.extraLoadCents ?? 0),
      money(l.amounts.monthlyFeeCents),
      money(l.amounts.trackersCents),
      money(l.amounts.extraLoadsCents),
      money(l.amounts.totalCents),
      l.longLoads
    ]
      .map(cell)
      .join(",")
  );
  return [head.join(","), ...body].join("\n") + "\n";
}

// ---------- scheduler ----------

const g = globalThis as unknown as { __rioUsageScheduler?: NodeJS.Timeout };

/** Hourly: marks trackers used this month (cheap, idempotent insert). */
export function startUsageScheduler(intervalMs = 3_600_000) {
  if (g.__rioUsageScheduler) return;
  const tick = () =>
    recordTrackerMonths().then(
      (n) => n && logger.info("usage.trackers_recorded", { added: n }),
      (err) => logger.error("usage.trackers_failed", {}, err)
    );
  setTimeout(tick, 30_000).unref?.();
  logger.info("usage.scheduler_started", { intervalMinutes: intervalMs / 60_000 });
  g.__rioUsageScheduler = setInterval(tick, intervalMs);
  g.__rioUsageScheduler.unref?.();
}
