import type { TenantContext } from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { alertMeta } from "./alert-meta";
import { logger } from "./logger";

/**
 * Push notifications for the mobile app. A phone registers its push address (an Expo
 * push token) for the signed-in user in their current organization and says which kinds
 * of alert it wants. Nothing is sent unless at least one phone is registered.
 *
 * Messages carry the vehicle name, what happened and the rule name: never a position.
 */
export const PUSH_KINDS = ["speeding", "zones", "offline", "maintenance"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const Token = z
  .string()
  .trim()
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/, "Not a valid push token");

export const PushDeviceInputSchema = z.object({
  token: Token,
  platform: z.enum(["ios", "android"]),
  speeding: z.boolean().default(true),
  zones: z.boolean().default(true),
  offline: z.boolean().default(true),
  maintenance: z.boolean().default(false)
});
export const PushDeviceRemoveSchema = z.object({ token: Token });

export interface PushDeviceDto {
  id: string;
  platform: string;
  speeding: boolean;
  zones: boolean;
  offline: boolean;
  maintenance: boolean;
  lastSeenAt: string;
}

/** Registers this phone for the caller, or updates its choices. A token belongs to one user at a time. */
export async function registerPushDevice(ctx: TenantContext, input: z.infer<typeof PushDeviceInputSchema>): Promise<PushDeviceDto> {
  const values = { organizationId: ctx.organizationId, userId: ctx.userId, platform: input.platform, speeding: input.speeding, zones: input.zones, offline: input.offline, maintenance: input.maintenance, lastSeenAt: new Date() };
  const [row] = await getDb()
    .insert(schema.pushDevices)
    .values({ token: input.token, ...values })
    .onConflictDoUpdate({ target: schema.pushDevices.token, set: values })
    .returning();
  return toDto(row!);
}

/** The caller's own phones in the current organization (never the token itself). */
export async function listPushDevices(ctx: TenantContext): Promise<PushDeviceDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.pushDevices)
    .where(and(eq(schema.pushDevices.organizationId, ctx.organizationId), eq(schema.pushDevices.userId, ctx.userId)));
  return rows.map(toDto);
}

/** Removes the caller's own registration for this token (sign-out on the phone). Someone else's token is left alone. */
export async function removePushDevice(ctx: TenantContext, token: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.pushDevices)
    .where(and(eq(schema.pushDevices.token, token), eq(schema.pushDevices.userId, ctx.userId)))
    .returning({ id: schema.pushDevices.id });
  return rows.length > 0;
}

function toDto(r: typeof schema.pushDevices.$inferSelect): PushDeviceDto {
  return { id: r.id, platform: r.platform, speeding: r.speeding, zones: r.zones, offline: r.offline, maintenance: r.maintenance, lastSeenAt: r.lastSeenAt.toISOString() };
}

// ---------- sending ----------

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string | number>;
  sound: "default";
  channelId: string;
}
/** Sends a batch and returns one result per message, in order. */
export type PushTransport = (messages: PushMessage[]) => Promise<{ ok: boolean; unregistered?: boolean }[]>;

const expoTransport: PushTransport = async (messages) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`push service answered ${res.status}`);
    const body = (await res.json()) as { data?: { status?: string; details?: { error?: string } }[] };
    return messages.map((_, i) => {
      const t = body.data?.[i];
      return { ok: t?.status === "ok", unregistered: t?.details?.error === "DeviceNotRegistered" };
    });
  } finally {
    clearTimeout(timer);
  }
};

let transport: PushTransport = expoTransport;
export function setPushTransportForTests(t: PushTransport | null) {
  transport = t ?? expoTransport;
}

/** Which notification choice covers an alert type; null = this alert type is never pushed. */
export function pushKindForAlert(type: string): PushKind | null {
  if (type === "speeding") return "speeding";
  if (type === "geofence_enter" || type === "geofence_exit") return "zones";
  if (type === "device_offline") return "offline";
  return null;
}

/**
 * Pushes alerts to the organization's registered phones that asked for that kind and whose
 * user is still a member. Best effort: failures are logged, never thrown. Phones the push
 * service reports as gone are forgotten.
 */
export async function pushAlerts(organizationId: string, alerts: { id: number; type: string; vehicleName: string | null; ruleName: string }[]): Promise<number> {
  const wanted = alerts.map((a) => ({ a, kind: pushKindForAlert(a.type) })).filter((x): x is { a: (typeof alerts)[number]; kind: PushKind } => x.kind !== null);
  if (wanted.length === 0) return 0;
  try {
    const db = getDb();
    const d = schema.pushDevices;
    const devices = await db
      .select({ id: d.id, token: d.token, speeding: d.speeding, zones: d.zones, offline: d.offline, maintenance: d.maintenance })
      .from(d)
      .innerJoin(schema.memberships, and(eq(schema.memberships.userId, d.userId), eq(schema.memberships.organizationId, d.organizationId)))
      .where(eq(d.organizationId, organizationId));
    if (devices.length === 0) return 0;
    const messages: PushMessage[] = [];
    const owners: string[] = [];
    for (const { a, kind } of wanted) {
      for (const dev of devices) {
        if (!dev[kind]) continue;
        messages.push({ to: dev.token, title: `${a.vehicleName ?? "A vehicle"} ${alertMeta(a.type).short}`, body: a.ruleName, data: { alertId: a.id, type: a.type }, sound: "default", channelId: "alerts" });
        owners.push(dev.id);
      }
    }
    if (messages.length === 0) return 0;
    let sent = 0;
    const gone = new Set<string>();
    // The push service accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const results = await transport(messages.slice(i, i + 100));
      results.forEach((r, j) => {
        if (r.ok) sent++;
        else if (r.unregistered) gone.add(owners[i + j]!);
      });
    }
    if (gone.size) await db.delete(d).where(inArray(d.id, [...gone]));
    logger.info("push.alerts_sent", { organizationId, sent, removedDevices: gone.size });
    return sent;
  } catch (err) {
    logger.error("push.alerts_failed", { organizationId }, err);
    return 0;
  }
}
