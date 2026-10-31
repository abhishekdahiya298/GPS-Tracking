import { getDb, schema } from "@rio-gps/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import { getServerEnv } from "./env";
import { AppError } from "./errors";
import { logger } from "./logger";
import type { SimStatus } from "./sims";

/**
 * Hologram SIM sync (read-only). Hologram stays the place where SIMs are activated, paused and
 * paid for; RIO only copies what it needs to tie each SIM to a tracker and a customer:
 * ICCID, phone number, status, plan, APN, and the tracker it is in.
 *
 * Which tracker: the IMEI Hologram last saw the SIM in, else a 15-digit IMEI in the SIM's name
 * in Hologram (RIO names them "GPS-<IMEI>"). Monthly cost and notes stay as entered in RIO.
 * Runs every 6 hours (one process, advisory lock) and from the "Sync now" button.
 */

const BASE = "https://dashboard.hologram.io/api/1";
const SYNC_LOCK_KEY = 72_310_019;
const PAGE = 1000;

export interface HologramSim {
  deviceId: string;
  name: string | null;
  imei: string | null;
  iccid: string;
  msisdn: string | null;
  state: string;
  plan: string | null;
  apn: string | null;
}

/** Hologram link states → RIO's four SIM statuses. */
export function mapHologramState(state: string): SimStatus {
  const s = state.toUpperCase();
  if (s === "LIVE" || s === "LIVE-PENDING") return "active";
  if (s.startsWith("PAUSED") || s.startsWith("FROZEN")) return "suspended";
  if (s.startsWith("DEAD")) return "cancelled";
  return "inventory"; // INACTIVE, FACTORY, TEST-*: not billed as a live line
}

/** The tracker IMEI for a SIM: Hologram's last seen IMEI, else 15 digits in its name. */
export function imeiForSim(sim: Pick<HologramSim, "imei" | "name">): string | null {
  if (sim.imei && /^\d{15}$/.test(sim.imei)) return sim.imei;
  const m = sim.name?.match(/(?<!\d)(\d{15})(?!\d)/);
  return m ? m[1]! : null;
}

export function isHologramConfigured(): boolean {
  return Boolean(getServerEnv().HOLOGRAM_API_KEY);
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike | null = null;
/** Tests replace Hologram's API. */
export function setHologramFetchForTests(f: FetchLike | null) {
  fetchImpl = f;
}

type DeviceObject = {
  id: number;
  name?: string | null;
  imei?: string | null;
  phonenumber?: string | null;
  intended_plan_name?: string | null;
  links?: { cellular?: { sim?: string; msisdn?: string | null; state?: string; apn?: string | null }[] };
};

/** Every SIM in the Hologram organization (all pages). */
export async function fetchHologramSims(): Promise<HologramSim[]> {
  const env = getServerEnv();
  if (!env.HOLOGRAM_API_KEY) throw new AppError("HOLOGRAM_NOT_CONFIGURED", 409, "Hologram isn't connected: add HOLOGRAM_API_KEY to the server settings.");
  const auth = `Basic ${Buffer.from(`apikey:${env.HOLOGRAM_API_KEY}`).toString("base64")}`;
  const out: HologramSim[] = [];
  let startAfter: number | null = null;
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ limit: String(PAGE), withlocation: "false" });
    if (env.HOLOGRAM_ORG_ID) q.set("orgid", env.HOLOGRAM_ORG_ID);
    if (startAfter !== null) q.set("startafter", String(startAfter));
    const res = await (fetchImpl ?? fetch)(`${BASE}/devices?${q}`, { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new AppError("HOLOGRAM_AUTH", 502, "Hologram refused the API key. Check HOLOGRAM_API_KEY (and HOLOGRAM_ORG_ID).");
    if (!res.ok) throw new AppError("HOLOGRAM_UNAVAILABLE", 502, `Hologram answered ${res.status}; try again later.`);
    const body = (await res.json()) as { success?: boolean; continues?: boolean; lastid?: number; data?: DeviceObject[] };
    for (const d of body.data ?? []) {
      for (const l of d.links?.cellular ?? []) {
        if (!l.sim) continue;
        out.push({
          deviceId: String(d.id),
          name: d.name ?? null,
          imei: d.imei ?? null,
          iccid: l.sim.replace(/\D/g, ""),
          msisdn: (l.msisdn || d.phonenumber || null)?.toString() ?? null,
          state: l.state ?? "INACTIVE",
          plan: d.intended_plan_name ?? null,
          apn: l.apn ?? null
        });
      }
    }
    if (!body.continues || body.lastid == null) break;
    startAfter = body.lastid;
  }
  return out;
}

export interface SyncResult {
  seen: number;
  added: number;
  updated: number;
  linked: number;
  unmatched: string[];
}

/**
 * Copies Hologram's SIMs into sim_cards (by ICCID). Returns null when another process holds the
 * lock. Never removes a SIM: one Hologram no longer lists simply stops being refreshed.
 */
export async function syncHologramSims(actorUserId: string | null, now = new Date()): Promise<SyncResult | null> {
  const sims = await fetchHologramSims();
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) as ok`);
    if (!(lock as { ok?: boolean } | undefined)?.ok) return null;
    const r: SyncResult = { seen: sims.length, added: 0, updated: 0, linked: 0, unmatched: [] };
    const imeis = [...new Set(sims.map(imeiForSim).filter((v): v is string => Boolean(v)))];
    const devices = imeis.length ? await tx.select({ id: schema.gpsDevices.id, imei: schema.gpsDevices.imei }).from(schema.gpsDevices).where(inArray(schema.gpsDevices.imei, imeis)) : [];
    const deviceByImei = new Map(devices.map((d) => [d.imei, d.id]));
    for (const s of sims) {
      if (!/^\d{18,22}$/.test(s.iccid)) continue;
      const status = mapHologramState(s.state);
      const fields = { msisdn: s.msisdn, carrier: "Hologram", plan: s.plan, apn: s.apn, status, provider: "hologram", providerRef: s.deviceId, syncedAt: now };
      const [existing] = await tx.select().from(schema.simCards).where(eq(schema.simCards.iccid, s.iccid)).for("update");
      let simId: string;
      if (!existing) {
        const [ins] = await tx.insert(schema.simCards).values({ iccid: s.iccid, ...fields, activatedAt: status === "active" ? now : null }).returning({ id: schema.simCards.id });
        simId = ins!.id;
        r.added++;
      } else {
        simId = existing.id;
        const changed = existing.status !== status || existing.plan !== s.plan || existing.msisdn !== s.msisdn || existing.apn !== s.apn || existing.provider !== "hologram";
        await tx
          .update(schema.simCards)
          .set({ ...fields, ...(status === "active" && existing.status !== "active" ? { activatedAt: now } : {}), ...(changed ? { updatedAt: now } : {}) })
          .where(eq(schema.simCards.id, simId));
        if (changed) r.updated++;
      }
      const imei = imeiForSim(s);
      const deviceId = imei ? deviceByImei.get(imei) : undefined;
      if (!deviceId) {
        if (imei) r.unmatched.push(imei);
        continue;
      }
      if (existing?.deviceId === deviceId) continue;
      // One SIM per tracker: a different SIM recorded in that tracker is taken out of it.
      await tx.update(schema.simCards).set({ deviceId: null, updatedAt: now }).where(and(eq(schema.simCards.deviceId, deviceId), sql`${schema.simCards.id} <> ${simId}`));
      await tx.update(schema.simCards).set({ deviceId, updatedAt: now }).where(eq(schema.simCards.id, simId));
      r.linked++;
    }
    return r;
  });
  if (result && (result.added || result.updated || result.linked || actorUserId)) {
    await writeAudit({ action: "sim.synced", actorUserId, organizationId: null, targetType: "sim", targetId: null, metadata: { provider: "hologram", seen: result.seen, added: result.added, updated: result.updated, linked: result.linked, unmatched: result.unmatched.length } });
  }
  return result;
}

/** Last successful sync, for the SIM cards page. */
export async function lastHologramSync(): Promise<string | null> {
  const [r] = await getDb().execute<{ at: Date | null }>(sql`select max(synced_at) as at from sim_cards where provider = 'hologram'`);
  return r?.at ? new Date(r.at).toISOString() : null;
}

const g = globalThis as unknown as { __rioHologramSync?: NodeJS.Timeout };

/** Every 6 hours (first run a minute after start), only when a key is configured. */
export function startHologramSyncScheduler(intervalMs = 6 * 3_600_000) {
  if (g.__rioHologramSync || !isHologramConfigured()) return;
  const tick = () =>
    syncHologramSims(null).then(
      (r) => r && logger.info("hologram.sync", { seen: r.seen, added: r.added, updated: r.updated, linked: r.linked, unmatched: r.unmatched.length }),
      (err) => logger.error("hologram.sync_failed", {}, err)
    );
  setTimeout(tick, 60_000).unref?.();
  g.__rioHologramSync = setInterval(tick, intervalMs);
  g.__rioHologramSync.unref?.();
  logger.info("hologram.scheduler_started", { intervalHours: intervalMs / 3_600_000 });
}
