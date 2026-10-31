import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { OrganizationStatus } from "./organization-status";

/**
 * Read models for the platform console (platform admins only; callers check isSuperAdmin).
 * Aggregates across every customer; archived customers are left out of the live numbers.
 */

const likeP = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface AttentionItem {
  id: string;
  name: string;
  issue: "no_trackers" | "all_silent" | "some_silent" | "never_signed_in" | "inactive_users" | "suspended";
  detail: string;
  trackers: number;
  silent: number;
}

export interface PlatformOverview {
  customers: { active: number; suspended: number; archived: number; newLast30: number };
  trackers: { total: number; online: number; silent24h: number; never: number; deactivated: number };
  users: { total: number; signedInLast7: number };
  loadsActive: number;
  alerts24h: number;
  newLeads: number;
  /** Stock and SIM housekeeping. */
  inventory: { inStock: number; deployedNoSim: number; simsActiveUnused: number; simsWastedCents: number; simsDeployedNotActive: number };
  attention: AttentionItem[];
  recentCustomers: { id: string; name: string; createdAt: string; trackers: number; status: OrganizationStatus }[];
}

export async function getPlatformOverview(onlineThresholdSeconds: number, now = new Date()): Promise<PlatformOverview> {
  const db = getDb();
  const at = now.toISOString();
  const [[cust], [trk], [usr], [misc], attentionRows, recent, [inv]] = await Promise.all([
    db.execute<{ active: number; suspended: number; archived: number; new30: number }>(sql`
      select count(*) filter (where status = 'active')::int as active,
             count(*) filter (where status = 'suspended')::int as suspended,
             count(*) filter (where status = 'archived')::int as archived,
             count(*) filter (where created_at > ${at}::timestamptz - interval '30 days' and status <> 'archived')::int as new30
      from organizations`),
    db.execute<{ total: number; online: number; silent: number; never: number; deactivated: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where d.status = 'active' and d.last_seen_at > ${at}::timestamptz - make_interval(secs => ${onlineThresholdSeconds}))::int as online,
             count(*) filter (where d.status = 'active' and d.last_seen_at <= ${at}::timestamptz - interval '24 hours')::int as silent,
             count(*) filter (where d.status = 'active' and d.last_seen_at is null)::int as never,
             count(*) filter (where d.status <> 'active')::int as deactivated
      from gps_devices d join organizations o on o.id = d.organization_id and o.status <> 'archived'`),
    db.execute<{ total: number; recent: number }>(sql`
      select count(distinct u.id)::int as total,
             count(distinct u.id) filter (where exists (select 1 from sessions s where s.user_id = u.id and s.created_at > ${at}::timestamptz - interval '7 days'))::int as recent
      from users u join memberships m on m.user_id = u.id join organizations o on o.id = m.organization_id and o.status <> 'archived'
      where not u.is_super_admin`),
    db.execute<{ loads: number; alerts: number; leads: number }>(sql`
      select (select count(*)::int from loads l join organizations o on o.id = l.organization_id and o.status = 'active'
                where l.status in ('invited', 'tracking', 'at_pickup', 'in_transit', 'at_delivery')) as loads,
             (select count(*)::int from alert_events where occurred_at > ${at}::timestamptz - interval '24 hours') as alerts,
             (select count(*)::int from leads where status = 'new') as leads`),
    db.execute<{ id: string; name: string; status: OrganizationStatus; created_at: Date; trackers: number; silent: number; never: number; members: number; signed_in_ever: number; signed_in_14d: number }>(sql`
      select o.id, o.name, o.status, o.created_at,
        (select count(*)::int from gps_devices d where d.organization_id = o.id and d.status = 'active') as trackers,
        (select count(*)::int from gps_devices d where d.organization_id = o.id and d.status = 'active'
           and d.last_seen_at <= ${at}::timestamptz - interval '24 hours') as silent,
        (select count(*)::int from gps_devices d where d.organization_id = o.id and d.status = 'active' and d.last_seen_at is null) as never,
        (select count(*)::int from memberships m join users u on u.id = m.user_id where m.organization_id = o.id and not u.is_super_admin) as members,
        (select count(*)::int from memberships m join users u on u.id = m.user_id
           where m.organization_id = o.id and not u.is_super_admin and exists (select 1 from sessions s where s.user_id = u.id)) as signed_in_ever,
        (select count(*)::int from memberships m join users u on u.id = m.user_id
           where m.organization_id = o.id and not u.is_super_admin and exists (select 1 from sessions s where s.user_id = u.id and s.created_at > ${at}::timestamptz - interval '14 days')) as signed_in_14d
      from organizations o where o.status <> 'archived'`),
    db.execute<{ id: string; name: string; created_at: Date; trackers: number; status: OrganizationStatus }>(sql`
      select o.id, o.name, o.created_at, o.status, (select count(*)::int from gps_devices d where d.organization_id = o.id) as trackers
      from organizations o where o.status <> 'archived' order by o.created_at desc limit 5`),
    db.execute<{ in_stock: number; no_sim: number; unused: number; wasted: number; off: number }>(sql`
      select (select count(*)::int from gps_devices where organization_id is null and status <> 'retired') as in_stock,
        (select count(*)::int from gps_devices d join organizations o on o.id = d.organization_id and o.status <> 'archived'
           where d.status = 'active' and not exists (select 1 from sim_cards s where s.device_id = d.id)) as no_sim,
        count(*) filter (where s.status = 'active' and (d.id is null or d.organization_id is null or d.status = 'retired'))::int as unused,
        coalesce(sum(s.monthly_cost_cents) filter (where s.status = 'active' and (d.id is null or d.organization_id is null or d.status = 'retired')), 0)::int as wasted,
        count(*) filter (where s.status <> 'active' and d.organization_id is not null and d.status = 'active')::int as off
      from sim_cards s left join gps_devices d on d.id = s.device_id`)
  ]);

  const attention: (AttentionItem & { rank: number })[] = [];
  for (const r of attentionRows) {
    const base = { id: r.id, name: r.name, trackers: r.trackers, silent: r.silent + r.never };
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    if (r.status === "suspended") attention.push({ ...base, issue: "suspended", detail: "Suspended: users can't sign in", rank: 5 });
    else if (r.trackers === 0) attention.push({ ...base, issue: "no_trackers", detail: "No trackers registered yet", rank: 1 });
    else if (r.silent + r.never >= r.trackers) attention.push({ ...base, issue: "all_silent", detail: r.trackers === 1 ? "Its only tracker is silent (24 h or more)" : `All ${r.trackers} trackers silent for 24 h or more`, rank: 0 });
    else if (r.silent + r.never > 0) attention.push({ ...base, issue: "some_silent", detail: `${plural(r.silent + r.never, "tracker")} of ${r.trackers} silent for 24 h or more`, rank: 2 });
    else if (r.members > 0 && r.signed_in_ever === 0) attention.push({ ...base, issue: "never_signed_in", detail: "Nobody has signed in yet", rank: 3 });
    else if (r.members > 0 && r.signed_in_14d === 0) attention.push({ ...base, issue: "inactive_users", detail: "No sign-in in the last 14 days", rank: 4 });
  }
  attention.sort((a, b) => a.rank - b.rank || b.silent - a.silent || a.name.localeCompare(b.name));

  return {
    customers: { active: cust!.active, suspended: cust!.suspended, archived: cust!.archived, newLast30: cust!.new30 },
    trackers: { total: trk!.total, online: trk!.online, silent24h: trk!.silent, never: trk!.never, deactivated: trk!.deactivated },
    users: { total: usr!.total, signedInLast7: usr!.recent },
    loadsActive: misc!.loads,
    alerts24h: misc!.alerts,
    newLeads: misc!.leads,
    inventory: { inStock: inv?.in_stock ?? 0, deployedNoSim: inv?.no_sim ?? 0, simsActiveUnused: inv?.unused ?? 0, simsWastedCents: inv?.wasted ?? 0, simsDeployedNotActive: inv?.off ?? 0 },
    attention: attention.slice(0, 8).map(({ rank: _rank, ...a }) => a),
    recentCustomers: recent.map((r) => ({ id: r.id, name: r.name, createdAt: new Date(r.created_at).toISOString(), trackers: r.trackers, status: r.status }))
  };
}

// ---------- tracker inventory: every tracker, in stock or with a customer ----------

export const TRACKER_STATES = ["all", "stock", "deployed", "online", "silent", "never", "nosim", "retired"] as const;
export const PlatformTrackerQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50, 100].includes(n)).default(25),
  search: z.string().trim().max(100).default(""),
  state: z.enum(TRACKER_STATES).default("all"),
  sort: z.enum(["lastSeen", "customer", "name", "changed"]).default("lastSeen"),
  direction: z.enum(["asc", "desc"]).default("desc")
});
export type PlatformTrackerQuery = z.infer<typeof PlatformTrackerQuery>;

export interface PlatformTrackerRow {
  id: string;
  name: string | null;
  model: string | null;
  /** Full IMEI: platform admins match it against the label on the box. */
  imei: string;
  serialNumber: string | null;
  notes: string | null;
  status: string;
  lastSeenAt: string | null;
  inventoryChangedAt: string | null;
  /** null = in RIO's stock. */
  customer: { id: string; name: string; status: OrganizationStatus } | null;
  vehicleName: string | null;
  sim: { id: string; iccid: string; msisdn: string | null; status: string; carrier: string | null } | null;
}

/** Every tracker, in stock or with a (non-archived) customer, with its SIM. */
export async function listPlatformTrackers(q: PlatformTrackerQuery, onlineThresholdSeconds: number, now = new Date()) {
  const at = now.toISOString();
  const digits = /^\d{3,22}$/.test(q.search) ? sql` or d.imei like ${likeP(q.search)} or coalesce(s.iccid, '') like ${likeP(q.search)} or coalesce(s.msisdn, '') like ${likeP(q.search)}` : sql``;
  const search = q.search
    ? sql`and (coalesce(d.name, '') ilike ${likeP(q.search)} or coalesce(d.model, '') ilike ${likeP(q.search)} or coalesce(d.serial_number, '') ilike ${likeP(q.search)} or coalesce(o.name, '') ilike ${likeP(q.search)}${digits})`
    : sql``;
  const deployed = sql`d.organization_id is not null`;
  const stateWhere = {
    all: sql`true`,
    stock: sql`d.organization_id is null and d.status <> 'retired'`,
    deployed,
    online: sql`${deployed} and d.status = 'active' and d.last_seen_at > ${at}::timestamptz - make_interval(secs => ${onlineThresholdSeconds})`,
    silent: sql`${deployed} and d.status = 'active' and d.last_seen_at <= ${at}::timestamptz - interval '24 hours'`,
    never: sql`${deployed} and d.status = 'active' and d.last_seen_at is null`,
    nosim: sql`d.status <> 'retired' and s.id is null`,
    retired: sql`d.status = 'retired'`
  };
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order = {
    lastSeen: sql`d.last_seen_at ${dir} nulls last`,
    customer: sql`lower(o.name) ${dir} nulls first`,
    name: sql`lower(coalesce(d.name, d.model, '')) ${dir}`,
    changed: sql`coalesce(d.inventory_changed_at, d.created_at) ${dir}`
  }[q.sort];
  const base = sql`from gps_devices d left join organizations o on o.id = d.organization_id left join sim_cards s on s.device_id = d.id
    where (o.id is null or o.status <> 'archived') ${search}`;
  const db = getDb();
  const [rows, counts] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select d.id, d.name, d.model, d.imei, d.serial_number, d.platform_notes, d.status, d.last_seen_at, d.inventory_changed_at,
        o.id as org_id, o.name as org_name, o.status as org_status,
        s.id as sim_id, s.iccid, s.msisdn, s.status as sim_status, s.carrier,
        (select v.name from device_assignments a join vehicles v on v.id = a.vehicle_id and v.organization_id = a.organization_id
           where a.device_id = d.id and a.organization_id = d.organization_id and a.unassigned_at is null limit 1) as vehicle_name,
        count(*) over()::int as total
      ${base} and ${stateWhere[q.state]}
      order by ${order}, d.id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<Record<(typeof TRACKER_STATES)[number], number>>(sql`
      select count(*)::int as all,
        count(*) filter (where ${stateWhere.stock})::int as stock,
        count(*) filter (where ${stateWhere.deployed})::int as deployed,
        count(*) filter (where ${stateWhere.online})::int as online,
        count(*) filter (where ${stateWhere.silent})::int as silent,
        count(*) filter (where ${stateWhere.never})::int as never,
        count(*) filter (where ${stateWhere.nosim})::int as nosim,
        count(*) filter (where ${stateWhere.retired})::int as retired
      ${base}`)
  ]);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    items: rows.map(
      (r): PlatformTrackerRow => ({
        id: String(r.id),
        name: (r.name as string | null) ?? null,
        model: (r.model as string | null) ?? null,
        imei: String(r.imei),
        serialNumber: (r.serial_number as string | null) ?? null,
        notes: (r.platform_notes as string | null) ?? null,
        status: String(r.status),
        lastSeenAt: iso(r.last_seen_at),
        inventoryChangedAt: iso(r.inventory_changed_at),
        customer: r.org_id ? { id: String(r.org_id), name: String(r.org_name), status: r.org_status as OrganizationStatus } : null,
        vehicleName: (r.vehicle_name as string | null) ?? null,
        sim: r.sim_id ? { id: String(r.sim_id), iccid: String(r.iccid), msisdn: (r.msisdn as string | null) ?? null, status: String(r.sim_status), carrier: (r.carrier as string | null) ?? null } : null
      })
    ),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize,
    counts: counts[0] ?? { all: 0, stock: 0, deployed: 0, online: 0, silent: 0, never: 0, nosim: 0, retired: 0 }
  };
}

// ---------- platform activity log ----------

export const ACTIVITY_KINDS = ["all", "customers", "trackers", "access", "people"] as const;
export const ActivityQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).default(50),
  search: z.string().trim().max(100).default(""),
  kind: z.enum(ACTIVITY_KINDS).default("all"),
  /** Only actions taken by platform admins (the default), or everything. */
  who: z.enum(["platform", "everyone"]).default("platform")
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

const KIND_WHERE = {
  all: sql`true`,
  customers: sql`a.action like 'customer.%'`,
  trackers: sql`(a.action like 'device.%' or a.action like 'sim.%')`,
  access: sql`(a.action like 'admin.%' or a.action like 'auth.%')`,
  people: sql`(a.action like 'member.%' or a.action like 'membership.%' or a.action like 'user.%')`
};

export interface ActivityRow {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  actorIsPlatform: boolean;
  customerId: string | null;
  customerName: string | null;
  targetType: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
}

/** The audit log across all customers, newest first. Metadata never holds secrets (see auditLogs). */
export async function listActivity(q: ActivityQuery) {
  const search = q.search ? sql`and (o.name ilike ${likeP(q.search)} or coalesce(u.email, '') ilike ${likeP(q.search)} or a.action ilike ${likeP(q.search)})` : sql``;
  const who = q.who === "platform" ? sql`and u.is_super_admin` : sql``;
  const rows = await getDb().execute<{ id: string; occurred_at: Date; action: string; actor_name: string | null; actor_email: string | null; is_super_admin: boolean | null; org_id: string | null; org_name: string | null; target_type: string | null; metadata: Record<string, unknown> | null; ip_address: string | null; total: number }>(sql`
    select a.id, a.occurred_at, a.action, u.name as actor_name, u.email as actor_email, u.is_super_admin, o.id as org_id, o.name as org_name,
      a.target_type, a.metadata, a.ip_address, count(*) over()::int as total
    from audit_logs a
    left join users u on u.id = a.actor_user_id
    left join organizations o on o.id = a.organization_id
    where ${KIND_WHERE[q.kind]} ${who} ${search}
    order by a.occurred_at desc, a.id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
  return {
    items: rows.map(
      (r): ActivityRow => ({
        id: r.id,
        at: new Date(r.occurred_at).toISOString(),
        action: r.action,
        actorName: r.actor_name || r.actor_email,
        actorIsPlatform: Boolean(r.is_super_admin),
        customerId: r.org_id,
        customerName: r.org_name,
        targetType: r.target_type,
        metadata: r.metadata,
        ipAddress: r.ip_address
      })
    ),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize
  };
}
