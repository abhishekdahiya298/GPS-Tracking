import { getDb } from "@rio-gps/db";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

/**
 * Server-side paginated lists for vehicles and devices. Search, sort, state
 * filter and paging all happen in SQL and every query is scoped to the
 * caller's organization; the browser never receives more than one page.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;

const base = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), "pageSize must be 10, 25, 50 or 100")
    .default(25),
  search: z.string().trim().max(100).default(""),
  direction: z.enum(["asc", "desc"]).default("asc")
};

export const VEHICLE_STATES = ["moving", "idle", "offline", "never_seen", "inactive", "no_device"] as const;
export type VehicleState = (typeof VEHICLE_STATES)[number];

export const VehicleListQuery = z.object({
  ...base,
  sort: z.enum(["name", "plate", "state", "speed", "lastSeen"]).default("state"),
  state: z.enum(["all", "moving", "idle", "offline", "no_device"]).default("all")
});
export type VehicleListQuery = z.infer<typeof VehicleListQuery>;

export const DeviceListQuery = z.object({
  ...base,
  sort: z.enum(["name", "vehicle", "state", "lastSeen"]).default("name"),
  state: z.enum(["all", "online", "offline", "never_seen", "inactive", "unassigned"]).default("all")
});
export type DeviceListQuery = z.infer<typeof DeviceListQuery>;

/** Parse URLSearchParams / Next searchParams leniently: invalid values fall back to defaults. */
export function parseListQuery<T extends z.ZodTypeAny>(schema: T, params: Record<string, string | string[] | undefined>): z.infer<T> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === "string") flat[k] = v;
  const r = schema.safeParse(flat);
  if (r.success) return r.data;
  // Drop only the invalid keys and retry, so one bad value doesn't reset everything.
  for (const issue of r.error.issues) delete flat[String(issue.path[0])];
  return schema.parse(flat);
}

/** LIKE pattern with user input escaped (no wildcards injected by the user). */
function likePattern(s: string) {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface VehicleRow {
  id: string;
  name: string;
  licensePlate: string | null;
  vehicleStatus: string;
  state: VehicleState;
  device: { id: string; name: string | null; model: string | null } | null;
  lastSeenAt: string | null;
  location: { latitude: number; longitude: number; speedKph: number | null; headingDeg: number | null; ignition: boolean | null; recordedAt: string } | null;
}

export interface Page<T, S extends string> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<S | "all", number>>;
}

const vehicleBase = (organizationId: string, offlineSeconds: number, now: Date) => sql`
  select v.id, v.name, v.license_plate, v.status as vehicle_status,
         d.id as device_id, d.name as device_name, d.model as device_model, d.last_seen_at,
         cl.latitude, cl.longitude, cl.speed_kph, cl.heading_deg, cl.ignition, cl.recorded_at,
         case
           when d.id is null then 'no_device'
           when d.status <> 'active' then 'inactive'
           when d.last_seen_at is null then 'never_seen'
           when d.last_seen_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${offlineSeconds}) then 'offline'
           when coalesce(cl.speed_kph, 0) >= 5 then 'moving'
           else 'idle'
         end as state
  from vehicles v
  left join lateral (
    select gd.* from device_assignments a
    join gps_devices gd on gd.id = a.device_id and gd.organization_id = ${organizationId}
    where a.vehicle_id = v.id and a.organization_id = ${organizationId} and a.unassigned_at is null
    order by gd.last_seen_at desc nulls last
    limit 1
  ) d on true
  left join current_locations cl on cl.device_id = d.id and cl.organization_id = ${organizationId}
  where v.organization_id = ${organizationId}`;

const STATE_RANK = sql`case state when 'moving' then 0 when 'idle' then 1 when 'offline' then 2 when 'never_seen' then 3 when 'inactive' then 4 else 5 end`;

export async function listVehiclesPage(organizationId: string, q: VehicleListQuery, now: Date, offlineSeconds: number): Promise<Page<VehicleRow, VehicleState>> {
  const db = getDb();
  const search = q.search
    ? sql` and (v.name ilike ${likePattern(q.search)} or coalesce(v.license_plate, '') ilike ${likePattern(q.search)} or coalesce(d.name, '') ilike ${likePattern(q.search)} or coalesce(d.model, '') ilike ${likePattern(q.search)})`
    : sql``;
  const inner = sql`${vehicleBase(organizationId, offlineSeconds, now)}${search}`;
  const stateFilter = q.state === "all" ? sql`true` : q.state === "offline" ? sql`state in ('offline', 'never_seen', 'inactive')` : sql`state = ${q.state}`;
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order: SQL = {
    name: sql`lower(name) ${dir}`,
    plate: sql`lower(license_plate) ${dir} nulls last`,
    state: sql`${STATE_RANK} ${dir}, last_seen_at desc nulls last`,
    speed: sql`coalesce(speed_kph, -1) ${dir}`,
    lastSeen: sql`last_seen_at ${dir} nulls last`
  }[q.sort];
  const rows = await db.execute<Record<string, unknown>>(sql`
    with f as (${inner})
    select *, count(*) over() as total from f where ${stateFilter}
    order by ${order}, lower(name) asc, id asc
    limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
  const countRows = await db.execute<{ state: VehicleState; n: number }>(sql`with f as (${inner}) select state, count(*)::int as n from f group by state`);
  const counts: Page<VehicleRow, VehicleState>["counts"] = { all: 0 };
  for (const c of countRows) {
    counts[c.state] = c.n;
    counts.all = (counts.all ?? 0) + c.n;
  }
  const total = rows.length ? Number(rows[0]!.total) : 0;
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      licensePlate: (r.license_plate as string | null) ?? null,
      vehicleStatus: String(r.vehicle_status),
      state: r.state as VehicleState,
      device: r.device_id ? { id: String(r.device_id), name: (r.device_name as string | null) ?? null, model: (r.device_model as string | null) ?? null } : null,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
      location:
        r.latitude !== null && r.latitude !== undefined
          ? {
              latitude: Number(r.latitude),
              longitude: Number(r.longitude),
              speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
              headingDeg: r.heading_deg === null ? null : Number(r.heading_deg),
              ignition: (r.ignition as boolean | null) ?? null,
              recordedAt: new Date(r.recorded_at as string).toISOString()
            }
          : null
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts
  };
}

export type DeviceState = "online" | "offline" | "never_seen" | "inactive" | "retired";
export interface DeviceRow {
  id: string;
  name: string | null;
  model: string | null;
  status: string;
  state: DeviceState;
  imeiLast4?: string;
  lastSeenAt: string | null;
  vehicle: { id: string; name: string; assignedAt: string } | null;
}

export async function listDevicesPage(
  organizationId: string,
  q: DeviceListQuery,
  now: Date,
  offlineSeconds: number,
  opts: { includeImeiLast4: boolean }
): Promise<Page<DeviceRow, DeviceState | "unassigned">> {
  const db = getDb();
  const s = q.search;
  const imeiSearch = opts.includeImeiLast4 && /^\d{4,15}$/.test(s) ? sql` or d.imei like ${`%${s}`}` : sql``;
  const search = s
    ? sql` and (coalesce(d.name, '') ilike ${likePattern(s)} or coalesce(d.model, '') ilike ${likePattern(s)} or coalesce(v.name, '') ilike ${likePattern(s)}${imeiSearch})`
    : sql``;
  const inner = sql`
    select d.id, d.name, d.model, d.status, d.imei, d.last_seen_at, d.created_at,
           v.id as vehicle_id, v.name as vehicle_name, a.assigned_at,
           case
             when d.status = 'retired' then 'retired'
             when d.status <> 'active' then 'inactive'
             when d.last_seen_at is null then 'never_seen'
             when d.last_seen_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${offlineSeconds}) then 'offline'
             else 'online'
           end as state
    from gps_devices d
    left join device_assignments a on a.device_id = d.id and a.organization_id = ${organizationId} and a.unassigned_at is null
    left join vehicles v on v.id = a.vehicle_id and v.organization_id = ${organizationId}
    where d.organization_id = ${organizationId}${search}`;
  const stateFilter =
    q.state === "all" ? sql`true` : q.state === "unassigned" ? sql`vehicle_id is null` : q.state === "inactive" ? sql`state in ('inactive', 'retired')` : sql`state = ${q.state}`;
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const order: SQL = {
    name: sql`lower(coalesce(name, model, '')) ${dir}`,
    vehicle: sql`lower(vehicle_name) ${dir} nulls last`,
    state: sql`case state when 'online' then 0 when 'offline' then 1 when 'never_seen' then 2 else 3 end ${dir}`,
    lastSeen: sql`last_seen_at ${dir} nulls last`
  }[q.sort];
  const rows = await db.execute<Record<string, unknown>>(sql`
    with f as (${inner})
    select *, count(*) over() as total from f where ${stateFilter}
    order by ${order}, created_at asc, id asc
    limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
  const countRows = await db.execute<{ state: DeviceState; n: number; unassigned: number }>(
    sql`with f as (${inner}) select state, count(*)::int as n, count(*) filter (where vehicle_id is null)::int as unassigned from f group by state`
  );
  const counts: Page<DeviceRow, DeviceState | "unassigned">["counts"] = { all: 0, unassigned: 0 };
  for (const c of countRows) {
    counts[c.state] = (counts[c.state] ?? 0) + c.n;
    counts.all = (counts.all ?? 0) + c.n;
    counts.unassigned = (counts.unassigned ?? 0) + c.unassigned;
  }
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      name: (r.name as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      status: String(r.status),
      state: r.state as DeviceState,
      ...(opts.includeImeiLast4 ? { imeiLast4: String(r.imei).slice(-4) } : {}),
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
      vehicle: r.vehicle_id ? { id: String(r.vehicle_id), name: String(r.vehicle_name), assignedAt: new Date(r.assigned_at as string).toISOString() } : null
    })),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize,
    counts
  };
}

export interface VehicleDetail {
  vehicle: { id: string; name: string; licensePlate: string | null; status: string };
  device: { id: string; name: string | null; model: string | null; status: string; imeiLast4?: string; assignedAt: string } | null;
  lastSeenAt: string | null;
  state: VehicleState;
  location: VehicleRow["location"];
}

/** One vehicle with its current device and position (tenant-scoped; null when not found). */
export async function getVehicleDetail(organizationId: string, vehicleId: string, now: Date, offlineSeconds: number, opts: { includeImeiLast4: boolean }): Promise<VehicleDetail | null> {
  const db = getDb();
  const [r] = await db.execute<Record<string, unknown>>(sql`
    with f as (${vehicleBase(organizationId, offlineSeconds, now)} and v.id = ${vehicleId})
    select f.*, gd.status as device_status, gd.imei, a.assigned_at
    from f
    left join gps_devices gd on gd.id = f.device_id and gd.organization_id = ${organizationId}
    left join device_assignments a on a.device_id = f.device_id and a.organization_id = ${organizationId} and a.unassigned_at is null`);
  if (!r) return null;
  return {
    vehicle: { id: String(r.id), name: String(r.name), licensePlate: (r.license_plate as string | null) ?? null, status: String(r.vehicle_status) },
    device: r.device_id
      ? {
          id: String(r.device_id),
          name: (r.device_name as string | null) ?? null,
          model: (r.device_model as string | null) ?? null,
          status: String(r.device_status),
          ...(opts.includeImeiLast4 ? { imeiLast4: String(r.imei).slice(-4) } : {}),
          assignedAt: new Date(r.assigned_at as string).toISOString()
        }
      : null,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
    state: r.state as VehicleState,
    location:
      r.latitude !== null && r.latitude !== undefined
        ? {
            latitude: Number(r.latitude),
            longitude: Number(r.longitude),
            speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
            headingDeg: r.heading_deg === null ? null : Number(r.heading_deg),
            ignition: (r.ignition as boolean | null) ?? null,
            recordedAt: new Date(r.recorded_at as string).toISOString()
          }
        : null
  };
}
