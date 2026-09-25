import { ORG_ROLES, type OrgRole } from "@rio-gps/core";
import { getDb } from "@rio-gps/db";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { PAGE_SIZES } from "./fleet-list";
import type { MemberDto } from "./team";

/** Paged, searchable member list for one organization (SQL does the work; org-scoped). */
export const TeamListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(25),
  search: z.string().trim().max(100).default(""),
  role: z.enum(["all", ...ORG_ROLES]).default("all"),
  sort: z.enum(["name", "role", "lastActive"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc")
});
export type TeamListQuery = z.infer<typeof TeamListQuery>;

export interface TeamPage {
  items: MemberDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<OrgRole | "all", number>>;
}

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listMembersPage(organizationId: string, q: TeamListQuery): Promise<TeamPage> {
  const db = getDb();
  const search = q.search ? sql` and (u.name ilike ${likePattern(q.search)} or u.email ilike ${likePattern(q.search)})` : sql``;
  const base = sql`
    select u.id as user_id, u.name, u.email, u.is_super_admin, m.role, m.created_at as member_since,
           (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in
    from memberships m join users u on u.id = m.user_id
    where m.organization_id = ${organizationId}${search}`;
  const roleFilter = q.role === "all" ? sql`true` : sql`role = ${q.role}`;
  const dir = q.direction === "desc" ? sql`desc` : sql`asc`;
  const ROLE_RANK = sql`case role when 'ORG_ADMIN' then 0 when 'FLEET_MANAGER' then 1 when 'DISPATCHER' then 2 else 3 end`;
  const order: SQL = { name: sql`lower(name) ${dir}`, role: sql`${ROLE_RANK} ${dir}, lower(name) asc`, lastActive: sql`last_sign_in ${dir} nulls last` }[q.sort];
  const [rows, countRows] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      with f as (${base}) select *, count(*) over() as total from f where ${roleFilter}
      order by ${order}, user_id asc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    db.execute<{ role: OrgRole; n: number }>(sql`with f as (${base}) select role, count(*)::int as n from f group by role`)
  ]);
  const counts: TeamPage["counts"] = { all: 0 };
  for (const c of countRows) {
    counts[c.role] = c.n;
    counts.all = (counts.all ?? 0) + c.n;
  }
  return {
    items: rows.map((r) => ({
      userId: String(r.user_id),
      name: String(r.name),
      email: String(r.email),
      role: r.role as OrgRole,
      memberSince: new Date(r.member_since as string).toISOString(),
      lastSignInAt: r.last_sign_in ? new Date(r.last_sign_in as string).toISOString() : null,
      isSuperAdmin: Boolean(r.is_super_admin)
    })),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: q.page,
    pageSize: q.pageSize,
    counts
  };
}
