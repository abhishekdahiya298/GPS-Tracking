import { getDb, schema } from "@rio-gps/db";
import { desc, eq, sql } from "drizzle-orm";
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

export interface LeadDto {
  id: string;
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
    leads: rows.map((r) => ({ id: r.id, name: r.name, company: r.company, email: r.email, phone: r.phone, fleetSize: r.fleetSize, country: r.country, message: r.message, status: r.status as LeadStatus, createdAt: r.createdAt.toISOString() })),
    newCount: Number(c?.n ?? 0)
  };
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<void> {
  const rows = await getDb().update(schema.leads).set({ status, updatedAt: new Date() }).where(eq(schema.leads.id, id)).returning({ id: schema.leads.id });
  if (rows.length === 0) throw new NotFoundError("Request not found");
}
