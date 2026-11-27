import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { DRIVERS_ORG_SLUG } from "./driver-loads";
import { likePattern } from "./fleet-list";

/**
 * Console → All drivers (C21): every driver on RIO GPS, one row per person (by mobile number),
 * with every company they work with, the app, the last place their phone reported and the load
 * they're on. Super admins only (the page checks).
 */
export interface PlatformDriverRow {
  key: string;
  name: string;
  phone: string | null;
  companies: { id: string; name: string; link: string; independent: boolean }[];
  app: "on" | "location_off" | "signed_out" | "not_joined";
  lastAt: string | null;
  latitude: number | null;
  longitude: number | null;
  load: { id: string; organizationId: string; reference: string; status: string } | null;
  joinedAt: string;
}

export const PLATFORM_DRIVER_FILTERS = ["all", "independent", "company", "app_on", "location_off", "not_joined"] as const;

export async function listPlatformDrivers(q: { search?: string; filter?: (typeof PLATFORM_DRIVER_FILTERS)[number]; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, q.page ?? 1);
  const size = Math.min(100, q.pageSize ?? 50);
  const search = q.search?.trim() ? sql`and (d.name ilike ${likePattern(q.search.trim())} or coalesce(d.phone,'') ilike ${likePattern(q.search.trim())} or o.name ilike ${likePattern(q.search.trim())})` : sql``;
  const rows = await getDb().execute<{
    key: string; name: string; phone: string | null; companies: PlatformDriverRow["companies"]; signed_in: boolean; loc_off: boolean; last_at: Date | string | null;
    lat: number | null; lon: number | null; load: PlatformDriverRow["load"]; joined_at: Date | string; total: number;
    c_all: number; c_independent: number; c_company: number; c_app_on: number; c_location_off: number; c_not_joined: number;
  }>(sql`
    with d as (
      select d.*, coalesce(d.phone, d.id::text) as person, o.name as org_name, o.slug as org_slug
      from drivers d join organizations o on o.id = d.organization_id
      where d.status = 'active' and o.status <> 'archived' ${search}
    ),
    people as (
      select d.person as key,
        (array_agg(d.name order by (d.org_slug = ${DRIVERS_ORG_SLUG}) desc, d.updated_at desc))[1] as name,
        max(d.phone) as phone,
        json_agg(json_build_object('id', d.organization_id, 'name', d.org_name, 'link', d.app_link, 'independent', d.org_slug = ${DRIVERS_ORG_SLUG}) order by d.org_name) as companies,
        bool_or(exists (select 1 from driver_app_sessions x where x.driver_id = d.id and x.revoked_at is null)) as signed_in,
        bool_or(exists (select 1 from driver_app_status s where s.driver_id = d.id and (s.permission = 'off' or s.location_enabled = false))) as loc_off,
        max(cl.recorded_at) as last_at,
        (array_agg(cl.latitude order by cl.recorded_at desc nulls last))[1] as lat,
        (array_agg(cl.longitude order by cl.recorded_at desc nulls last))[1] as lon,
        min(d.created_at) as joined_at,
        bool_and(d.org_slug <> ${DRIVERS_ORG_SLUG}) as in_company,
        bool_or(d.org_slug = ${DRIVERS_ORG_SLUG}) and count(*) = 1 as only_independent
      from d left join current_locations cl on cl.device_id = d.phone_device_id
      group by d.person
    ),
    counted as (
      select p.*,
        count(*) over() as c_all,
        count(*) filter (where only_independent) over() as c_independent,
        count(*) filter (where not only_independent) over() as c_company,
        count(*) filter (where signed_in and not loc_off) over() as c_app_on,
        count(*) filter (where signed_in and loc_off) over() as c_location_off,
        count(*) filter (where not signed_in) over() as c_not_joined
      from people p
    )
    select c.*,
      (select json_build_object('id', l.id, 'organizationId', l.organization_id, 'reference', l.reference, 'status', l.status) from loads l
         where c.phone is not null and l.driver_phone = c.phone and l.status not in ('delivered','cancelled','declined') order by l.created_at desc limit 1) as load,
      count(*) over() as total
    from counted c
    where ${
      q.filter === "independent" ? sql`only_independent` : q.filter === "company" ? sql`not only_independent` : q.filter === "app_on" ? sql`signed_in and not loc_off` : q.filter === "location_off" ? sql`signed_in and loc_off` : q.filter === "not_joined" ? sql`not signed_in` : sql`true`
    }
    order by last_at desc nulls last, name
    limit ${size} offset ${(page - 1) * size}`);
  const first = rows[0];
  const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
  return {
    items: rows.map(
      (r): PlatformDriverRow => ({
        key: r.key,
        name: r.name,
        phone: r.phone,
        companies: r.companies ?? [],
        app: !r.signed_in ? "not_joined" : r.loc_off ? "location_off" : "on",
        lastAt: iso(r.last_at),
        latitude: r.lat == null ? null : Number(r.lat),
        longitude: r.lon == null ? null : Number(r.lon),
        load: r.load ?? null,
        joinedAt: iso(r.joined_at)!
      })
    ),
    total: Number(first?.total ?? 0),
    page,
    pageSize: size,
    counts: first
      ? { all: Number(first.c_all), independent: Number(first.c_independent), company: Number(first.c_company), app_on: Number(first.c_app_on), location_off: Number(first.c_location_off), not_joined: Number(first.c_not_joined) }
      : { all: 0, independent: 0, company: 0, app_on: 0, location_off: 0, not_joined: 0 }
  };
}
