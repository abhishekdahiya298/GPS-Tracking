import "./setup-env";
import { createHmac } from "node:crypto";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";
import { POST as resetTwoStepPOST } from "@/app/api/team/[userId]/reset-two-step/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let ipN = 1;
let session = "";
let secret = "";
let backupCodes: string[] = [];

function base32Decode(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
/** RFC 6238 code, the same sum an authenticator app does. */
function totp(base32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32Decode(base32)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
function cookieOf(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c): c is string => !!c && !c.endsWith("=")).join("; ");
}
function call(path: string, body: unknown, cookie = "", ip = `203.0.113.${ipN++}`) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return getAuth().handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}
const signIn = (ip?: string) => call("/sign-in/email", { email: "ann@a.test", password: PASSWORD }, "", ip);
const vehicles = (cookie: string) => vehiclesGET(new Request(`${BASE}/api/vehicles`, { headers: { cookie } }));

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate two_factors, verifications, audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" });
  await createUserWithMembership({ email: "ann@a.test", name: "Ann", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  const res = await signIn();
  expect(res.status).toBe(200);
  session = cookieOf(res);
});

afterAll(async () => {
  await closeDb();
});

describe("turning two-step verification on", () => {
  it("needs the account password", async () => {
    expect((await call("/two-factor/enable", { password: "wrong-password-entirely" }, session)).status).toBeGreaterThanOrEqual(400);
    expect((await call("/two-factor/enable", { password: PASSWORD })).status).toBe(401);
  });

  it("stays off until a code from the authenticator app is confirmed", async () => {
    const res = await call("/two-factor/enable", { password: PASSWORD }, session);
    expect(res.status).toBe(200);
    const body = await res.json();
    const uri = new URL(body.totpURI);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("issuer")).toBe("RIO Tracking");
    secret = uri.searchParams.get("secret")!;
    backupCodes = body.backupCodes;
    expect(backupCodes.length).toBeGreaterThanOrEqual(8);
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "ann@a.test"));
    expect(u!.twoFactorEnabled).toBe(false);
    // Signing in still works with the password alone until setup is confirmed.
    expect((await (await signIn()).json()).twoFactorRedirect).toBeUndefined();

    expect((await call("/two-factor/verify-totp", { code: "000000" }, session)).status).toBeGreaterThanOrEqual(400);
    const ok = await call("/two-factor/verify-totp", { code: totp(secret) }, session);
    expect(ok.status).toBe(200);
    session = cookieOf(ok) || session;
    const [after] = await getDb().select().from(schema.users).where(eq(schema.users.email, "ann@a.test"));
    expect(after!.twoFactorEnabled).toBe(true);
  });

  it("stores the secret and backup codes encrypted, never in the clear", async () => {
    const [row] = await getDb().select().from(schema.twoFactors);
    expect(row!.secret).not.toContain(secret);
    for (const c of backupCodes) expect(row!.backupCodes).not.toContain(c);
  });
});

describe("signing in with two-step verification on", () => {
  let pending = "";

  it("gives no session after the password alone", async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRedirect).toBe(true);
    pending = cookieOf(res);
    // Whatever token header the response carries must not open a session for a phone.
    const t = res.headers.get("set-auth-token");
    if (t) expect((await vehiclesGET(new Request(`${BASE}/api/vehicles`, { headers: { authorization: `Bearer ${t}` } }))).status).toBe(401);
    expect(pending).not.toMatch(/session_token=[^;]/);
    expect((await vehicles(pending)).status).toBe(401);
  });

  it("rejects a wrong code and accepts the right one", async () => {
    expect((await call("/two-factor/verify-totp", { code: "123456" }, pending)).status).toBeGreaterThanOrEqual(400);
    expect((await vehicles(pending)).status).toBe(401);
    const res = await call("/two-factor/verify-totp", { code: totp(secret) }, pending);
    expect(res.status).toBe(200);
    expect((await vehicles(cookieOf(res))).status).toBe(200);
  });

  it("accepts each backup code once", async () => {
    const first = cookieOf(await signIn());
    const res = await call("/two-factor/verify-backup-code", { code: backupCodes[0] }, first);
    expect(res.status).toBe(200);
    expect((await vehicles(cookieOf(res))).status).toBe(200);
    const second = cookieOf(await signIn());
    expect((await call("/two-factor/verify-backup-code", { code: backupCodes[0] }, second)).status).toBeGreaterThanOrEqual(400);
  });

  it("limits guessing: repeated wrong codes from one address are refused", async () => {
    const ip = "198.51.100.77";
    const p = cookieOf(await signIn(ip));
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await call("/two-factor/verify-totp", { code: String(100000 + i) }, p, ip)).status);
    expect(statuses.some((s) => s === 429)).toBe(true);
    // Even the right code no longer gets through on that attempt.
    expect((await call("/two-factor/verify-totp", { code: totp(secret) }, p, ip)).status).not.toBe(200);
  });
});

describe("audit trail", () => {
  it("records setup, failed second steps and backup code use, with no codes or secrets in it", async () => {
    const rows = await getDb().select().from(schema.auditLogs);
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === "auth.two_step_enabled")).toHaveLength(1);
    expect(actions).toContain("auth.two_step_failed");
    expect(actions).toContain("auth.backup_code_used");
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(secret);
    for (const c of backupCodes) expect(dump).not.toContain(c);
  });
});

describe("turning it off", () => {
  it("needs the password, then sign-in is password-only again", async () => {
    await getDb().execute(sql`truncate rate_limits`);
    const p = cookieOf(await signIn());
    const live = cookieOf(await call("/two-factor/verify-totp", { code: totp(secret) }, p));
    expect((await call("/two-factor/disable", { password: "wrong-password-entirely" }, live)).status).toBeGreaterThanOrEqual(400);
    expect((await call("/two-factor/disable", { password: PASSWORD }, live)).status).toBe(200);
    expect(await getDb().select().from(schema.twoFactors)).toHaveLength(0);
    expect((await getDb().select().from(schema.auditLogs)).map((r) => r.action)).toContain("auth.two_step_disabled");
    expect((await (await signIn()).json()).twoFactorRedirect).toBeUndefined();
  });
});

describe("an admin resetting a member's two-step verification (lost phone)", () => {
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const login = async (email: string) => cookieOf(await call("/sign-in/email", { email, password: PASSWORD }));
  const reset = (who: string, userId: string, origin = BASE) =>
    resetTwoStepPOST(new Request(`${BASE}/api/team/${userId}/reset-two-step`, { method: "POST", headers: { cookie: cookies[who]!, origin } }), { params: Promise.resolve({ userId }) });
  let memberSecret = "";

  beforeAll(async () => {
    const db = getDb();
    await db.execute(sql`truncate rate_limits`);
    await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" });
    await createUserWithMembership({ email: "mel@a.test", name: "Mel", password: PASSWORD, organizationSlug: "org-a", role: "DISPATCHER" });
    await createUserWithMembership({ email: "vic@a.test", name: "Vic", password: PASSWORD, organizationSlug: "org-a", role: "FLEET_MANAGER" });
    await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
    for (const u of await db.select().from(schema.users)) ids[u.email.split("@")[0]!] = u.id;
    for (const k of ["ann", "mel", "vic", "bob"]) cookies[k] = await login(`${k}@${k === "bob" ? "b" : "a"}.test`);
    const body = await (await call("/two-factor/enable", { password: PASSWORD }, cookies.mel)).json();
    memberSecret = new URL(body.totpURI).searchParams.get("secret")!;
    cookies.mel = cookieOf(await call("/two-factor/verify-totp", { code: totp(memberSecret) }, cookies.mel));
    expect((await vehicles(cookies.mel!)).status).toBe(200);
  });

  it("is refused for other organizations, for roles without team management, cross-site, and for yourself", async () => {
    expect((await reset("bob", ids.mel!)).status).toBe(404);
    expect((await reset("vic", ids.mel!)).status).toBe(403);
    expect((await reset("ann", ids.mel!, "https://evil.test")).status).toBe(403);
    expect((await reset("ann", ids.ann!)).status).toBe(409);
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.id, ids.mel!));
    expect(u!.twoFactorEnabled).toBe(true);
  });

  it("turns it off, signs the member out, keeps their password, and is audited", async () => {
    expect((await reset("ann", ids.mel!)).status).toBe(200);
    expect((await vehicles(cookies.mel!)).status).toBe(401);
    const res = await call("/sign-in/email", { email: "mel@a.test", password: PASSWORD });
    expect((await res.json()).twoFactorRedirect).toBeUndefined();
    expect((await vehicles(cookieOf(res))).status).toBe(200);
    expect(await getDb().select().from(schema.twoFactors).where(eq(schema.twoFactors.userId, ids.mel!))).toHaveLength(0);
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "member.two_step_reset"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: ids.ann, targetId: ids.mel });
    expect((await reset("ann", ids.mel!)).status).toBe(409);
  });
});
