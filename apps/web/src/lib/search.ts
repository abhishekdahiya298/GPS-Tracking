import { contextHasPermission, type TenantContext } from "@rio-gps/core";
import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Global search (command palette). Server-side, tenant-scoped, and permission-
 * checked per category with the same permissions as the pages; each category
 * returns at most PER_GROUP rows, so the browser never receives a data set.
 */
export const PER_GROUP = 5;
export const SearchQuery = z.object({ q: z.string().trim().min(2).max(100) });

export type SearchGroup = "vehicles" | "devices" | "alerts" | "zones" | "team" | "customers";
export interface SearchHit {
  group: SearchGroup;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export async function globalSearch(ctx: TenantContext, q: string): Promise<SearchHit[]> {
  const db = getDb();
  const org = ctx.organizationId;
  const p = like(q);
  const can = (perm: Parameters<typeof contextHasPermission>[1]) => contextHasPermission(ctx, perm);
  const jobs: Promise<SearchHit[]>[] = [];

  if (can("vehicles.read")) {
    jobs.push(
      db
        .execute<{ id: string; name: string; license_plate: string | null }>(sql`
          select id, name, license_plate from vehicles
          where organization_id = ${org} and (name ilike ${p} or coalesce(license_plate, '') ilike ${p})
          order by lower(name) limit ${PER_GROUP}`)
        .then((rows) => rows.map((r) => ({ group: "vehicles" as const, id: r.id, title: r.name, subtitle: r.license_plate, href: `/vehicles?${qs({ search: r.name })}` })))
    );
  }
  if (can("devices.read")) {
    // Admins can also find a unit by the last digits of its IMEI; the IMEI itself is never returned.
    const imeiMatch = can("devices.manage") && /^\d{4,15}$/.test(q) ? sql` or imei like ${`%${q}`}` : sql``;
    jobs.push(
      db
        .execute<{ id: string; name: string | null; model: string | null }>(sql`
          select id, name, model from gps_devices
          where organization_id = ${org} and (coalesce(name, '') ilike ${p} or coalesce(model, '') ilike ${p}${imeiMatch})
          order by lower(coalesce(name, model, '')) limit ${PER_GROUP}`)
        .then((rows) =>
          rows.map((r) => ({ group: "devices" as const, id: r.id, title: r.name ?? r.model ?? "Device", subtitle: r.name && r.model ? r.model : null, href: `/devices?${qs({ search: r.name ?? r.model ?? "" })}` }))
        )
    );
  }
  if (can("alerts.read")) {
    jobs.push(
      db
        .execute<{ id: number; rule_name: string; vehicle_name: string | null; occurred_at: Date }>(sql`
          select e.id, e.rule_name, v.name as vehicle_name, e.occurred_at
          from alert_events e left join vehicles v on v.id = e.vehicle_id and v.organization_id = ${org}
          where e.organization_id = ${org} and (e.rule_name ilike ${p} or coalesce(v.name, '') ilike ${p})
          order by e.occurred_at desc limit ${PER_GROUP}`)
        .then((rows) =>
          rows.map((r) => ({
            group: "alerts" as const,
            id: String(r.id),
            title: `${r.vehicle_name ?? "Device"}: ${r.rule_name}`,
            subtitle: new Date(r.occurred_at).toISOString(),
            href: `/alerts?${qs({ search: r.vehicle_name ?? r.rule_name })}`
          }))
        )
    );
  }
  if (can("geofences.read")) {
    jobs.push(
      db
        .execute<{ id: string; name: string }>(sql`select id, name from geofences where organization_id = ${org} and name ilike ${p} order by lower(name) limit ${PER_GROUP}`)
        .then((rows) => rows.map((r) => ({ group: "zones" as const, id: r.id, title: r.name, subtitle: null, href: "/geofences" })))
    );
  }
  if (can("users.read")) {
    jobs.push(
      db
        .execute<{ id: string; name: string; email: string }>(sql`
          select u.id, u.name, u.email from memberships m join users u on u.id = m.user_id
          where m.organization_id = ${org} and (u.name ilike ${p} or u.email ilike ${p})
          order by lower(u.name) limit ${PER_GROUP}`)
        .then((rows) => rows.map((r) => ({ group: "team" as const, id: r.id, title: r.name, subtitle: r.email, href: `/settings/team?${qs({ search: r.email })}` })))
    );
  }
  if (ctx.isSuperAdmin) {
    jobs.push(
      db
        .execute<{ id: string; name: string; slug: string }>(sql`select id, name, slug from organizations where name ilike ${p} or slug ilike ${p} order by lower(name) limit ${PER_GROUP}`)
        .then((rows) => rows.map((r) => ({ group: "customers" as const, id: r.id, title: r.name, subtitle: r.slug, href: `/admin/customers/${r.id}` })))
    );
  }
  return (await Promise.all(jobs)).flat();
}
