import { cleanFeatures, cleanLimits } from "@rio-gps/core";
import { getPlatformSettings } from "./platform-settings";
import { getDb, schema } from "@rio-gps/db";
import { hashPassword } from "better-auth/crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "./audit";
import { assertCanAdd, getSignupSettings, type SignupRole } from "./entitlements";
import { isEmailEnabled, leadEmail, sendEmail, signupCodeEmail } from "./email";
import { getServerEnv } from "./env";
import { ConflictError, ForbiddenError, TooManyRequestsError, ValidationError } from "./errors";
import { logger } from "./logger";
import { normalizePhone, PHONE_HINT } from "./phone";
import { assertRateLimit } from "./rate-limit";
import { getReadyRedisPublisher } from "./redis";
import { sendSms, smsConfigured } from "./sms";

/**
 * Public sign-up: a fleet owner, owner-operator or broker opens a company on the plan the
 * platform chose for that role (Free Basic by default); a driver joins their company with its
 * code. One 6-digit code is sent to the email and, when the server can send texts, to the phone
 * too; the person types it once (whichever arrives first). One phone can open only one company. Nothing is stored until the code is right; the password is never
 * kept outside the final account.
 */

const CODE_TTL_MS = 10 * 60_000;
const MAX_TRIES = 5;
const PENDING_TTL_S = 20 * 60;

const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);
const phone = z.string().trim().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_HINT });
  return p ?? "";
});

export const CompanySignupSchema = z.object({
  role: z.enum(["fleet", "operator", "broker"]),
  company: text(2, 80, "Enter your company name"),
  name: text(2, 80, "Enter your name"),
  phone,
  email: z.string().trim().toLowerCase().email("Enter an email like name@company.com").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  fleetSize: z.enum(["1", "2-5", "6-20", "21-50", "50+"]).default("1"),
  country: z.enum(["CA", "US"]).default("CA"),
  timeZone: z.string().max(64).default("America/Toronto"),
  agree: z.literal(true, { errorMap: () => ({ message: "Please agree to the Terms and Privacy policy" }) })
});
export type CompanySignup = z.infer<typeof CompanySignupSchema>;

export const DriverJoinSchema = z.object({
  code: z.string().trim().toUpperCase().min(4, "Enter your company's code").max(40),
  name: text(2, 80, "Enter your name"),
  phone
});

export const VerifySchema = z.object({ token: z.string().min(16).max(64), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"), password: z.string().max(128).optional() });

type Pending = ({ kind: "company" } & Omit<CompanySignup, "password" | "agree">) | ({ kind: "driver"; organizationId: string; companyName: string } & Omit<z.infer<typeof DriverJoinSchema>, "code">);

// ---------- phone codes ----------

const hashCode = (phone: string, code: string) => createHash("sha256").update(`${getServerEnv().AUTH_SECRET}:${phone}:${code}`).digest("hex");

/** Whether new sign-ups really get a text code (the setting is on and the server can send texts). */
export async function phoneCheckActive(): Promise<boolean> {
  return (await getSignupSettings()).phoneCheck && smsConfigured();
}

/** Where a sign-up code goes: the email (always, when email works) and the phone (when texts work). */
type CodeTo = { email?: string; name?: string; sms: boolean };
export type SentTo = { email: string | null; phone: string | null };

async function sendCode(phoneE164: string, purpose: "signup" | "driver_join" | "driver_signin", to: CodeTo = { sms: true }): Promise<SentTo> {
  await assertRateLimit("phone-code", phoneE164, 5, 3600, "Too many codes for this number. Try again in an hour.");
  const db = getDb();
  const [last] = await db.select({ createdAt: schema.phoneCodes.createdAt }).from(schema.phoneCodes).where(eq(schema.phoneCodes.phone, phoneE164)).orderBy(desc(schema.phoneCodes.createdAt)).limit(1);
  if (last && Date.now() - last.createdAt.getTime() < 40_000) throw new TooManyRequestsError("We just sent a code. Wait a few seconds before asking for another.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(schema.phoneCodes).values({ phone: phoneE164, purpose, codeHash: hashCode(phoneE164, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  let emailSent = false;
  let smsSent = false;
  let smsError = "";
  if (to.email && isEmailEnabled()) {
    try {
      await sendEmail(signupCodeEmail(to.email, to.name ?? "", code, CODE_TTL_MS / 60_000));
      emailSent = true;
    } catch (err) {
      logger.error("signup.code_email_failed", { purpose }, err);
    }
  }
  if (to.sms) {
    const sent = await sendSms(phoneE164, `${code} is your RIO GPS code. It expires in 10 minutes.`);
    smsSent = sent.sent;
    if (!sent.sent) smsError = sent.message || "";
  }
  if (!emailSent && !smsSent) throw new ValidationError(smsError || "We couldn't send your code. Check your email and phone, then try again.");
  return { email: emailSent && to.email ? maskEmail(to.email) : null, phone: smsSent ? mask(phoneE164) : null };
}

/**
 * Driver app sign-in code: by text when texts work, and by email to the driver's address on file
 * (the only way until the SMS number is approved).
 */
export async function sendDriverSignInCode(phoneE164: string, to: { email?: string | null; name?: string } = {}): Promise<SentTo> {
  return sendCode(phoneE164, "driver_signin", { email: to.email ?? undefined, name: to.name, sms: smsConfigured() });
}
export async function checkDriverSignInCode(phoneE164: string, code: string): Promise<void> {
  return checkCode(phoneE164, code);
}

/** Sign-up asks for a code when email or texts can deliver it. */
async function companyCodeChannels(): Promise<{ any: boolean; sms: boolean }> {
  const s = await getSignupSettings();
  const sms = s.phoneCheck && smsConfigured();
  return { any: (s.emailCheck && isEmailEnabled()) || sms, sms };
}

async function checkCode(phoneE164: string, code: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.phoneCodes)
    .where(and(eq(schema.phoneCodes.phone, phoneE164), isNull(schema.phoneCodes.verifiedAt), gt(schema.phoneCodes.expiresAt, new Date())))
    .orderBy(desc(schema.phoneCodes.createdAt))
    .limit(1);
  if (!row) throw new ValidationError("That code has expired. Send a new one.");
  if (row.attempts >= MAX_TRIES) throw new ValidationError("Too many wrong codes. Send a new one.");
  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(hashCode(phoneE164, code), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.update(schema.phoneCodes).set({ attempts: sql`${schema.phoneCodes.attempts} + 1` }).where(eq(schema.phoneCodes.id, row.id));
    throw new ValidationError("That code isn't right. Check your email or texts and try again.");
  }
  await db.update(schema.phoneCodes).set({ verifiedAt: new Date() }).where(eq(schema.phoneCodes.id, row.id));
}

async function savePending(p: Pending): Promise<string> {
  const token = randomBytes(18).toString("base64url");
  const redis = await getReadyRedisPublisher();
  await redis.set(`signup:${token}`, JSON.stringify(p), "EX", PENDING_TTL_S);
  return token;
}
async function readPending(token: string): Promise<Pending> {
  const redis = await getReadyRedisPublisher();
  const raw = await redis.get(`signup:${token}`);
  if (!raw) throw new ValidationError("This sign-up has expired. Please start again.");
  return JSON.parse(raw) as Pending;
}
async function dropPending(token: string) {
  try {
    await (await getReadyRedisPublisher()).del(`signup:${token}`);
  } catch {
    // expires anyway
  }
}

const maskEmail = (e: string) => {
  const [user = "", domain = ""] = e.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
};
const mask = (p: string) => `${p.slice(0, -4).replace(/\d/g, "•").replace(/^\+?•/, "+1 ")}${p.slice(-2).padStart(4, "•")}`;

// ---------- company sign-up ----------

export type StartResult = { status: "code_sent"; token: string; sentTo: SentTo } | { status: "created"; email: string };

/** Step 2: checks everything, then sends one code to the email and phone (or creates the company when no channel can deliver a code). */
export async function startCompanySignup(input: CompanySignup, ip: string | null): Promise<StartResult> {
  await assertRateLimit("signup", ip ?? "unknown", 5, 3600, "Too many sign-ups from this network. Try again later.");
  const settings = await getSignupSettings();
  if (!settings.roles[input.role].open) throw new ForbiddenError("Sign-up for this kind of account is closed. Contact RIO GPS.");
  await assertNewAccount(input.email, input.phone, settings.onePerPhone);
  const channels = await companyCodeChannels();
  if (channels.any) {
    const sentTo = await sendCode(input.phone, "signup", { email: settings.emailCheck ? input.email : undefined, name: input.name, sms: channels.sms });
    const rest: Omit<CompanySignup, "password" | "agree"> = { role: input.role, company: input.company, name: input.name, phone: input.phone, email: input.email, fleetSize: input.fleetSize, country: input.country, timeZone: input.timeZone };
    return { status: "code_sent", token: await savePending({ kind: "company", ...rest }), sentTo };
  }
  logger.warn("signup.code_skipped", { reason: "no_email_or_sms" });
  await createCompany(input, input.password);
  return { status: "created", email: input.email };
}

async function assertNewAccount(email: string, phoneE164: string, onePerPhone: boolean) {
  const db = getDb();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (u) throw new ConflictError("An account with this email already exists. Sign in instead, or use another email.");
  if (onePerPhone) {
    const [o] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.signupPhone, phoneE164)).limit(1);
    if (o) throw new ConflictError("This phone number already opened a company on RIO GPS. Sign in, or contact RIO GPS to add another company.");
  }
}

/** Step 3: the code is right → the company is created. The browser sends the password again. */
export async function verifySignup(input: z.infer<typeof VerifySchema>): Promise<{ status: "created"; email: string } | { status: "joined"; companyName: string }> {
  const pending = await readPending(input.token);
  await checkCode(pending.phone, input.code);
  if (pending.kind === "company") {
    if (!input.password || input.password.length < 10) throw new ValidationError("Use at least 10 characters for the password");
    const settings = await getSignupSettings();
    await assertNewAccount(pending.email, pending.phone, settings.onePerPhone);
    await createCompany({ ...pending, password: input.password, agree: true }, input.password);
    await dropPending(input.token);
    return { status: "created", email: pending.email };
  }
  await addJoinedDriver(pending);
  await dropPending(input.token);
  return { status: "joined", companyName: pending.companyName };
}

export async function resendCode(token: string): Promise<{ sentTo: SentTo }> {
  const pending = await readPending(token);
  if (pending.kind === "company") {
    const channels = await companyCodeChannels();
    const s = await getSignupSettings();
    return { sentTo: await sendCode(pending.phone, "signup", { email: s.emailCheck ? pending.email : undefined, name: pending.name, sms: channels.sms }) };
  }
  return { sentTo: await sendCode(pending.phone, "driver_join") };
}

function slugFrom(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "company";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

function joinCodeFrom(name: string): string {
  const word = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ")[0]?.slice(0, 10) || "RIO";
  return `${word}-${randomInt(1000, 10_000)}`;
}

async function createCompany(input: CompanySignup, password: string): Promise<string> {
  const db = getDb();
  const settings = await getSignupSettings();
  const roleSetting = settings.roles[input.role as SignupRole];
  const passwordHash = await hashPassword(password);
  const defaults = await getPlatformSettings();
  const { orgId, planName } = await db.transaction(async (tx) => {
    const publicPlans = await tx.select().from(schema.plans).where(and(eq(schema.plans.visibility, "public"), eq(schema.plans.active, true))).orderBy(asc(schema.plans.sortOrder));
    const freePlan = publicPlans[0];
    const [chosen] = roleSetting.planId ? await tx.select().from(schema.plans).where(eq(schema.plans.id, roleSetting.planId)) : [freePlan];
    const plan = chosen ?? freePlan;
    if (!plan) throw new ForbiddenError("Sign-up isn't available right now. Contact RIO GPS.");
    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: input.company, slug: slugFrom(input.company), timeZone: input.timeZone, unitSystem: input.country === "US" || defaults.defaultUnitSystem === "imperial" ? "imperial" : "metric", signupRole: input.role, signupPhone: input.phone, joinCode: joinCodeFrom(input.company), contactName: input.name, contactEmail: input.email, contactPhone: input.phone })
      .returning({ id: schema.organizations.id });
    await tx.insert(schema.gpsProviders).values({ organizationId: org!.id, kind: "traccar", name: "Traccar", apiBaseUrl: "http://traccar:8082" });
    const trialDays = roleSetting.trialDays;
    await tx.insert(schema.subscriptions).values({
      organizationId: org!.id,
      planId: plan.id,
      planName: plan.name,
      modules: plan.modules,
      includedLoads: plan.includedLoads,
      extraLoadCents: plan.extraLoadCents,
      monthlyFeeCents: plan.monthlyFeeCents,
      perTrackerCents: plan.perTrackerCents,
      lockedFeatures: cleanFeatures(plan.lockedFeatures),
      limits: cleanLimits(plan.limits),
      trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null,
      trialReturnPlanId: trialDays > 0 && freePlan && freePlan.id !== plan.id ? freePlan.id : null,
      note: `Signed up as ${input.role}`
    });
    const [user] = await tx.insert(schema.users).values({ email: input.email, name: input.name, emailVerified: false }).returning({ id: schema.users.id });
    await tx.insert(schema.accounts).values({ userId: user!.id, accountId: user!.id, providerId: "credential", password: passwordHash });
    await tx.insert(schema.memberships).values({ userId: user!.id, organizationId: org!.id, role: "ORG_ADMIN" });
    // An owner-operator drives the truck too.
    if (input.role === "operator") await tx.insert(schema.drivers).values({ organizationId: org!.id, name: input.name, phone: input.phone, email: input.email });
    await tx.insert(schema.leads).values({
      source: "signup",
      organizationId: org!.id,
      planName: plan.name,
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      fleetSize: input.fleetSize,
      country: input.country,
      message: `New ${input.role === "fleet" ? "fleet owner" : input.role === "operator" ? "owner-operator" : "broker"} sign-up`
    });
    return { orgId: org!.id, planName: plan.name };
  });
  await writeAudit({ action: "signup.company_created", actorUserId: null, organizationId: orgId, targetType: "organization", targetId: orgId, metadata: { role: input.role, plan: planName }, ipAddress: null, userAgent: null });
  logger.info("signup.company_created", { organizationId: orgId, role: input.role });
  if (settings.notifyEmail && isEmailEnabled()) {
    const admins = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.isSuperAdmin, true));
    for (const a of admins)
      await sendEmail(leadEmail(a.email, { name: input.name, company: `${input.company} (new ${planName} sign-up)`, email: input.email, phone: input.phone, fleetSize: input.fleetSize, country: input.country, message: `Role: ${input.role}` })).catch((err) =>
        logger.error("signup.notify_failed", { organizationId: orgId }, err)
      );
  }
  return orgId;
}

// ---------- driver joins ----------

export type JoinResult = { status: "code_sent"; token: string; sentTo: SentTo; companyName: string } | { status: "joined"; companyName: string };

export async function startDriverJoin(input: z.infer<typeof DriverJoinSchema>, ip: string | null): Promise<JoinResult> {
  await assertRateLimit("driver-join", ip ?? "unknown", 10, 3600, "Too many tries from this network. Try again later.");
  const settings = await getSignupSettings();
  if (!settings.roles.driver.open) throw new ForbiddenError("Drivers join through their company. Ask the person who runs your trucks to add you.");
  const [org] = await getDb()
    .select({ id: schema.organizations.id, name: schema.organizations.name, status: schema.organizations.status })
    .from(schema.organizations)
    .where(eq(schema.organizations.joinCode, input.code))
    .limit(1);
  if (!org || org.status !== "active") throw new ValidationError("We couldn't find a company with that code. Check it with your company.");
  if (settings.phoneCheck && smsConfigured()) {
    const sentTo = await sendCode(input.phone, "driver_join");
    return { status: "code_sent", token: await savePending({ kind: "driver", organizationId: org.id, companyName: org.name, name: input.name, phone: input.phone }), sentTo, companyName: org.name };
  }
  await addJoinedDriver({ kind: "driver", organizationId: org.id, companyName: org.name, name: input.name, phone: input.phone });
  return { status: "joined", companyName: org.name };
}

async function addJoinedDriver(p: Extract<Pending, { kind: "driver" }>) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: schema.drivers.id })
      .from(schema.drivers)
      .where(and(eq(schema.drivers.organizationId, p.organizationId), eq(schema.drivers.phone, p.phone)))
      .limit(1);
    if (dup) return;
    try {
      await assertCanAdd(p.organizationId, "drivers", tx);
    } catch {
      throw new ForbiddenError(`${p.companyName} can't add more drivers on its plan. Ask them to upgrade, then try again.`);
    }
    await tx.insert(schema.drivers).values({ organizationId: p.organizationId, name: p.name, phone: p.phone, notes: "Joined with the company code" });
  });
  await writeAudit({ action: "signup.driver_joined", actorUserId: null, organizationId: p.organizationId, targetType: "driver", targetId: null, metadata: { name: p.name }, ipAddress: null, userAgent: null });
}

/** The company's code for drivers (made on first use for companies created before codes). */
export async function companyJoinCode(organizationId: string): Promise<string> {
  const db = getDb();
  const [org] = await db.select({ code: schema.organizations.joinCode, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!org) throw new ValidationError("Company not found");
  if (org.code) return org.code;
  for (let i = 0; i < 5; i++) {
    const code = joinCodeFrom(org.name);
    try {
      await db.update(schema.organizations).set({ joinCode: code }).where(and(eq(schema.organizations.id, organizationId), isNull(schema.organizations.joinCode)));
      const [again] = await db.select({ code: schema.organizations.joinCode }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
      if (again?.code) return again.code;
    } catch {
      // code taken: try another
    }
  }
  throw new ConflictError("Couldn't make a company code. Try again.");
}

/** Which roles are open (the public sign-up page reads it). */
export async function signupOptions(): Promise<{ open: Record<SignupRole, boolean>; phoneCheck: boolean; emailCheck: boolean }> {
  const s = await getSignupSettings();
  return { open: { fleet: s.roles.fleet.open, operator: s.roles.operator.open, broker: s.roles.broker.open, driver: s.roles.driver.open }, phoneCheck: s.phoneCheck && smsConfigured(), emailCheck: s.emailCheck && isEmailEnabled() };
}


/**
 * Archives self-signed-up companies on a free plan (no fees) where nobody has signed in for the
 * configured number of days. Archived companies keep their data and can be restored in the console.
 */
export async function archiveInactiveFreeCompanies(now = new Date()): Promise<number> {
  const days = (await getSignupSettings()).archiveInactiveDays;
  if (days <= 0) return 0;
  const rows = await getDb().execute<{ id: string }>(sql`
    update organizations o set status = 'archived', status_reason = ${`No sign-in for ${days} days (free plan)`}, status_changed_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
    where o.status = 'active' and o.signup_role is not null and o.is_demo = false
      and o.created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${days})
      and exists (select 1 from subscriptions s where s.organization_id = o.id and s.ended_at is null and s.monthly_fee_cents = 0 and s.per_tracker_cents = 0 and s.extra_load_cents = 0)
      and not exists (
        select 1 from sessions se join memberships m on m.user_id = se.user_id
        where m.organization_id = o.id and se.updated_at > ${now.toISOString()}::timestamptz - make_interval(days => ${days}))
    returning o.id`);
  for (const r of rows) await writeAudit({ action: "customer.archived_inactive", actorUserId: null, organizationId: r.id, targetType: "organization", targetId: r.id, metadata: { days }, ipAddress: null, userAgent: null });
  if (rows.length) logger.info("signup.archived_inactive", { count: rows.length });
  return rows.length;
}
