import {
  atLimit,
  DEFAULT_FEATURE_RULES,
  FEATURES,
  isFeature,
  LIMIT_NOUN,
  type Feature,
  type FeatureRule,
  type LimitKey,
  type PlanLimits,
  type TenantContext
} from "@rio-gps/core";
import { getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import { AppError } from "./errors";
import { organizationPlanAccess } from "./plans";

/**
 * What a customer's plan allows, what they use, and the platform-wide settings around it
 * (what a customer sees for a feature that isn't in their plan, and how to reach RIO to upgrade).
 * Limits are checked on the server when something is added; screens show the same numbers.
 */

export class LimitReachedError extends AppError {
  constructor(
    public readonly limit: LimitKey,
    public readonly used: number,
    public readonly max: number,
    planName: string
  ) {
    super("LIMIT_REACHED", 403, `You've added ${used} of ${max} ${LIMIT_NOUN[limit]}. ${planName} includes ${max}. Request an upgrade to add more.`);
  }
  get details() {
    return { limit: this.limit, used: this.used, max: this.max };
  }
}

export class FeatureLockedError extends AppError {
  constructor(public readonly feature: Feature) {
    super("FEATURE_LOCKED", 403, "This isn't in your plan. Request an upgrade to switch it on.");
  }
  get details() {
    return { feature: this.feature };
  }
}

export function requireFeature(ctx: TenantContext, feature: Feature): void {
  if (ctx.lockedFeatures?.includes(feature)) throw new FeatureLockedError(feature);
}

// ---------- usage ----------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type Usage = Record<Exclude<LimitKey, "historyDays">, number>;

/** Counts for every limit (loads: created this calendar month in the company's time zone). */
export async function organizationUsage(organizationId: string, db: Db | Tx = getDb()): Promise<Usage> {
  const [r] = await db.execute<{ vehicles: number; drivers: number; members: number; trackers: number; loads: number }>(sql`
    select
      (select count(*)::int from vehicles where organization_id = o.id) as vehicles,
      (select count(*)::int from drivers where organization_id = o.id and status = 'active') as drivers,
      (select count(*)::int from memberships where organization_id = o.id) as members,
      (select count(*)::int from gps_devices where organization_id = o.id and status <> 'retired') as trackers,
      (select count(*)::int from loads where organization_id = o.id
         and created_at >= (date_trunc('month', now() at time zone o.time_zone) at time zone o.time_zone)) as loads
    from organizations o where o.id = ${organizationId}::uuid`);
  return { vehicles: r?.vehicles ?? 0, drivers: r?.drivers ?? 0, members: r?.members ?? 0, trackers: r?.trackers ?? 0, loadsPerMonth: r?.loads ?? 0 };
}

/**
 * Refuses to add one more of something when the plan's limit is reached. Call inside the same
 * transaction as the insert when possible (the organization row is locked so two quick adds
 * can't both slip under the limit).
 */
export async function assertCanAdd(organizationId: string, limit: Exclude<LimitKey, "historyDays">, db: Db | Tx = getDb()): Promise<void> {
  const access = await organizationPlanAccess(organizationId);
  const max = access?.limits[limit];
  if (max === undefined) return;
  await db.execute(sql`select 1 from organizations where id = ${organizationId}::uuid for update`);
  const used = (await organizationUsage(organizationId, db))[limit];
  if (atLimit(access!.limits, limit, used)) throw new LimitReachedError(limit, used, max, access!.planName);
}

/** The earliest moment history can be read from on this plan (null = no limit). */
export async function historyStartLimit(organizationId: string, now = new Date()): Promise<Date | null> {
  const access = await organizationPlanAccess(organizationId);
  const days = access?.limits.historyDays;
  if (days === undefined) return null;
  const [r] = await getDb().execute<{ start: string }>(sql`
    select (date_trunc('day', ${now.toISOString()}::timestamptz at time zone o.time_zone) - make_interval(days => ${Math.max(0, days - 1)})) at time zone o.time_zone as start
    from organizations o where o.id = ${organizationId}::uuid`);
  return r ? new Date(r.start) : null;
}

// ---------- platform settings ----------

const FEATURE_RULES_KEY = "feature_rules";
const UPGRADE_KEY = "upgrade_contact";
const SIGNUP_KEY = "signup";

async function readSetting(key: string): Promise<unknown> {
  const [row] = await getDb().select({ value: schema.platformSettings.value }).from(schema.platformSettings).where(eq(schema.platformSettings.key, key));
  return row?.value;
}
async function writeSetting(key: string, value: unknown, actorUserId: string) {
  await getDb()
    .insert(schema.platformSettings)
    .values({ key, value, updatedBy: actorUserId })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedAt: new Date(), updatedBy: actorUserId } });
}

export type FeatureRules = Record<Feature, FeatureRule>;

export async function getFeatureRules(): Promise<FeatureRules> {
  const raw = (await readSetting(FEATURE_RULES_KEY)) as Record<string, unknown> | undefined;
  const out = { ...DEFAULT_FEATURE_RULES };
  for (const [k, v] of Object.entries(raw ?? {})) if (isFeature(k) && (v === "lock" || v === "hide")) out[k] = v;
  return out;
}

export const FeatureRulesSchema = z.record(z.string(), z.enum(["lock", "hide"])).transform((v) => Object.fromEntries(Object.entries(v).filter(([k]) => isFeature(k))) as Partial<FeatureRules>);

export async function setFeatureRules(actorUserId: string, rules: Partial<FeatureRules>, meta: { ipAddress: string | null; userAgent: string | null }) {
  const merged = { ...(await getFeatureRules()), ...rules };
  await writeSetting(FEATURE_RULES_KEY, merged, actorUserId);
  await writeAudit({ action: "platform.feature_rules_changed", actorUserId, targetType: "platform_setting", targetId: FEATURE_RULES_KEY, metadata: { hidden: FEATURES.filter((f) => merged[f] === "hide") }, ...meta });
}

const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

export const UpgradeContactSchema = z.object({
  phone: optionalText(40),
  whatsapp: optionalText(40),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().email("Enter an email like name@company.com").max(200).optional()),
  message: optionalText(200),
  trialDays: z.coerce.number().int().min(1).max(90).default(14)
});
export type UpgradeContact = z.infer<typeof UpgradeContactSchema>;

export async function getUpgradeContact(): Promise<UpgradeContact> {
  const parsed = UpgradeContactSchema.safeParse((await readSetting(UPGRADE_KEY)) ?? {});
  return parsed.success ? parsed.data : { trialDays: 14 };
}

export const SIGNUP_ROLES = ["fleet", "operator", "broker", "driver"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

const roleSetting = (open: boolean) =>
  z.object({ open: z.boolean().default(open), planId: z.string().uuid().nullable().default(null), trialDays: z.coerce.number().int().min(0).max(90).default(0) }).default({});

export const SignupSettingsSchema = z.object({
  roles: z
    .object({ fleet: roleSetting(true), operator: roleSetting(true), broker: roleSetting(false), driver: roleSetting(true) })
    .default({}),
  phoneCheck: z.boolean().default(true),
  onePerPhone: z.boolean().default(true),
  archiveInactiveDays: z.coerce.number().int().min(0).max(3650).default(90),
  notifyEmail: z.boolean().default(true)
});
export type SignupSettings = z.infer<typeof SignupSettingsSchema>;

export async function getSignupSettings(): Promise<SignupSettings> {
  const parsed = SignupSettingsSchema.safeParse((await readSetting(SIGNUP_KEY)) ?? {});
  return parsed.success ? parsed.data : SignupSettingsSchema.parse({});
}

export const SignupAndUpgradeSchema = z.object({ signup: SignupSettingsSchema, contact: UpgradeContactSchema });

export async function setSignupAndUpgrade(actorUserId: string, input: z.infer<typeof SignupAndUpgradeSchema>, meta: { ipAddress: string | null; userAgent: string | null }) {
  await writeSetting(SIGNUP_KEY, input.signup, actorUserId);
  await writeSetting(UPGRADE_KEY, input.contact, actorUserId);
  await writeAudit({ action: "platform.signup_settings_changed", actorUserId, targetType: "platform_setting", targetId: SIGNUP_KEY, metadata: { roles: input.signup.roles }, ...meta });
}

// ---------- for screens ----------

export interface PlanAccessDto {
  planName: string;
  trialEndsAt: string | null;
  lockedFeatures: Feature[];
  /** Locked features shown with a lock (the rest are hidden). */
  lockShown: Feature[];
  limits: PlanLimits;
  usage: Usage;
  contact: UpgradeContact;
}

/** Everything the customer screens need to show locks and limits. Null = no plan recorded. */
export async function planAccessFor(organizationId: string): Promise<PlanAccessDto | null> {
  const access = await organizationPlanAccess(organizationId);
  if (!access) return null;
  const [rules, usage, contact] = await Promise.all([getFeatureRules(), organizationUsage(organizationId), getUpgradeContact()]);
  return {
    planName: access.planName,
    trialEndsAt: access.trialEndsAt?.toISOString() ?? null,
    lockedFeatures: access.lockedFeatures,
    lockShown: access.lockedFeatures.filter((f) => rules[f] === "lock"),
    limits: access.limits,
    usage,
    contact
  };
}

/** Page guard: a locked feature that's shown with a lock renders the lock page; hidden ones 404. */
export async function featureGate(ctx: TenantContext, feature: Feature): Promise<"open" | "lock" | "hide"> {
  if (!ctx.lockedFeatures?.includes(feature)) return "open";
  return (await getFeatureRules())[feature];
}

