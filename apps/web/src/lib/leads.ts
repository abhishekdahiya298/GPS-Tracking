import { getDb, schema } from "@rio-gps/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { leadEmail, sendEmail, isEmailEnabled } from "./email";
import { NotFoundError, TooManyRequestsError } from "./errors";
import { logger } from "./logger";
import { getReadyRedisPublisher } from "./redis";
import type { LeadInput, LeadStatus } from "./schemas/lead";

/**
 * "Get pricing" requests from the public site. Writing is public (rate-limited, same-origin);
 * reading and updating is for platform admins only (enforced by the callers' guards).
 */
const LIMIT_PER_HOUR = 5;

/** At most a handful of requests per address per hour. If Redis is down the form still works. */
export async function assertLeadRate(ip: string | null, now = Date.now()): Promise<void> {
  const key = `rl:lead:${ip ?? "unknown"}:${Math.floor(now / 3_600_000)}`;
  let n: number;
  try {
    const redis = await getReadyRedisPublisher();
    n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3700);
  } catch (err) {
    logger.warn("lead.rate_limit_unavailable", {}, err);
    return;
  }
  if (n > LIMIT_PER_HOUR) throw new TooManyRequestsError("Too many requests from this network. Please try again later or email us.");
}

/** Stores the request and tells the platform admins by email (best effort). Bots that fill the hidden field are dropped. */
export async function createLead(input: LeadInput): Promise<{ stored: boolean }> {
  if (input.website) {
    logger.info("lead.honeypot_dropped", {});
    return { stored: false };
  }
  const db = getDb();
  const [row] = await db
    .insert(schema.leads)
    .values({ name: input.name, company: input.company, email: input.email, phone: input.phone, fleetSize: input.fleetSize, country: input.country, message: input.message })
    .returning({ id: schema.leads.id });
  logger.info("lead.created", { leadId: row!.id, country: input.country, fleetSize: input.fleetSize });
  if (isEmailEnabled()) {
    const admins = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.isSuperAdmin, true));
    for (const a of admins) {
      try {
        await sendEmail(leadEmail(a.email, input));
      } catch (err) {
        logger.error("lead.notify_failed", { leadId: row!.id }, err);
      }
    }
  }
  return { stored: true };
}

export const UPGRADE_NEEDS = ["more_vehicles", "gps_trackers", "trip_history", "alerts", "reports", "zones", "maintenance", "loads", "shipper_links", "team"] as const;
export const UPGRADE_NEED_LABEL: Record<(typeof UPGRADE_NEEDS)[number], string> = {
  more_vehicles: "More trucks or drivers",
  gps_trackers: "GPS hardware trackers",
  trip_history: "Trip history",
  alerts: "Alerts",
  reports: "Reports",
  zones: "Zones",
  maintenance: "Maintenance",
  loads: "More loads",
  shipper_links: "Shipper tracking links",
  team: "More team members"
};

export const UpgradeRequestSchema = z.object({
  needs: z.array(z.enum(UPGRADE_NEEDS)).min(1, "Pick at least one thing you need").max(UPGRADE_NEEDS.length),
  trucks: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1, "Enter 1 or more").max(100_000).optional()),
  contactWay: z.enum(["whatsapp", "phone", "email"]),
  phone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(40).optional()),
  message: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000).optional())
});

/**
 * A customer's "Request upgrade". Becomes a lead (source "upgrade") with their plan and what they
 * asked for; platform admins are emailed. At most 3 a day per company.
 */
export async function createUpgradeRequest(
  who: { userId: string; name: string; email: string; organizationId: string },
  input: z.infer<typeof UpgradeRequestSchema>,
  planName: string | null
): Promise<{ id: string }> {
  const db = getDb();
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(eq(schema.leads.organizationId, who.organizationId), eq(schema.leads.source, "upgrade"), gt(schema.leads.createdAt, sql`now() - interval '1 day'`)));
  if ((recent?.n ?? 0) >= 3) throw new TooManyRequestsError("We already have your requests from today. We'll be in touch soon.");
  const [org] = await db.select({ name: schema.organizations.name, phone: schema.organizations.contactPhone }).from(schema.organizations).where(eq(schema.organizations.id, who.organizationId));
  const needsText = input.needs.map((n) => UPGRADE_NEED_LABEL[n]).join(", ");
  const [row] = await db
    .insert(schema.leads)
    .values({
      source: "upgrade",
      organizationId: who.organizationId,
      planName,
      needs: input.needs,
      contactWay: input.contactWay,
      name: who.name || who.email,
      company: org?.name ?? "",
      email: who.email,
      phone: input.phone ?? org?.phone ?? null,
      fleetSize: input.trucks ? String(input.trucks) : "",
      country: "",
      message: [`Wants: ${needsText}`, input.message].filter(Boolean).join("\n")
    })
    .returning({ id: schema.leads.id });
  logger.info("lead.upgrade_requested", { leadId: row!.id, organizationId: who.organizationId, needs: input.needs });
  if (isEmailEnabled()) {
    const admins = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.isSuperAdmin, true));
    for (const a of admins) {
      try {
        await sendEmail(
          leadEmail(a.email, {
            name: who.name || who.email,
            company: `${org?.name ?? ""} (upgrade request, ${planName ?? "no plan"})`,
            email: who.email,
            phone: input.phone ?? org?.phone ?? null,
            fleetSize: input.trucks ? String(input.trucks) : "-",
            country: "CA",
            message: [`Wants: ${needsText}`, `Reach by: ${input.contactWay}`, input.message].filter(Boolean).join("\n")
          })
        );
      } catch (err) {
        logger.error("lead.notify_failed", { leadId: row!.id }, err);
      }
    }
  }
  return { id: row!.id };
}

export interface LeadDto {
  id: string;
  source: string;
  organizationId: string | null;
  planName: string | null;
  needs: string[];
  contactWay: string | null;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  fleetSize: string;
  country: string;
  message: string | null;
  status: LeadStatus;
  createdAt: string;
}

export async function listLeads(limit = 200): Promise<{ leads: LeadDto[]; newCount: number }> {
  const db = getDb();
  const [rows, [c]] = await Promise.all([
    db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt)).limit(limit),
    db.select({ n: sql<string>`count(*)` }).from(schema.leads).where(eq(schema.leads.status, "new"))
  ]);
  return {
    leads: rows.map((r) => ({ id: r.id, source: r.source, organizationId: r.organizationId, planName: r.planName, needs: r.needs, contactWay: r.contactWay, name: r.name, company: r.company, email: r.email, phone: r.phone, fleetSize: r.fleetSize, country: r.country, message: r.message, status: r.status as LeadStatus, createdAt: r.createdAt.toISOString() })),
    newCount: Number(c?.n ?? 0)
  };
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<void> {
  const rows = await getDb().update(schema.leads).set({ status, updatedAt: new Date() }).where(eq(schema.leads.id, id)).returning({ id: schema.leads.id });
  if (rows.length === 0) throw new NotFoundError("Request not found");
}
