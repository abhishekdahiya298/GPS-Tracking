import "./setup-env";
import { createHmac } from "node:crypto";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as vehiclesGET, POST as vehiclesPOST } from "@/app/api/vehicles/route";

/**
 * The phone app's sign-in when the account has two-step verification on.
 * A phone keeps no cookie jar: it copies the short-lived "second step pending" cookie from the
 * password response into the code request by hand and ends up with a bearer token.
 *
 * The auth library refuses any request that carries a cookie without a trusted Origin (its
 * cross-site defence for browsers), so on that one request the app also sends the server's own
 * address as Origin. That weakens nothing: the defence exists because a browser attaches cookies
 * on its own, and a non-browser client holds no cookie it was not given.
 */
const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let ipN = 1;
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
function totp(base32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32Decode(base32)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c): c is string => !!c && !c.endsWith("="));

/** A browser, used only to turn two-step verification on (that is done on the website). */
function browser(path: string, body: unknown, cookie = "") {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${ipN++}` };
  if (cookie) headers.cookie = cookie;
  return getAuth().handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}
/** A phone: no cookie jar. `cookie` is only ever the pending second-step cookie, sent with Origin. */
function phone(path: string, body: unknown, opts: { cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipN++}` };
  if (opts.cookie) headers.cookie = opts.cookie;
  const origin = opts.origin === undefined ? (opts.cookie ? BASE : null) : opts.origin;
  if (origin) headers.origin = origin;
  return getAuth().handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}
const pendingCookie = (res: Response) => cookiesOf(res).find((c) => /two_factor=/.test(c)) ?? "";
const vehicles = (bearer: string) => vehiclesGET(new Request(`${BASE}/api/vehicles`, { headers: { authorization: `Bearer ${bearer}` } }));

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate two_factors, verifications, audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" });
  await createUserWithMembership({ email: "ann@a.test", name: "Ann", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  const session = cookiesOf(await browser("/sign-in/email", { email: "ann@a.test", password: PASSWORD })).join("; ");
  const body = await (await browser("/two-factor/enable", { password: PASSWORD }, session)).json();
  secret = new URL(body.totpURI).searchParams.get("secret")!;
  backupCodes = body.backupCodes;
  expect((await browser("/two-factor/verify-totp", { code: totp(secret) }, session)).status).toBe(200);
});

afterAll(async () => {
  await closeDb();
});

describe("phone sign-in with two-step verification on", () => {
  it("the password alone gives the phone a pending cookie and no usable token", async () => {
    const res = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRedirect).toBe(true);
    expect(pendingCookie(res)).not.toBe("");
    const t = res.headers.get("set-auth-token");
    if (t) expect((await vehicles(t)).status).toBe(401);
  });

  it("the code plus the pending cookie returns a bearer token that works", async () => {
    const first = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    const res = await phone("/two-factor/verify-totp", { code: totp(secret) }, { cookie: pendingCookie(first) });
    expect(res.status).toBe(200);
    const token = res.headers.get("set-auth-token") ?? "";
    expect(token.length).toBeGreaterThan(20);
    expect((await vehicles(token)).status).toBe(200);
    // The token alone (no cookie, no Origin) can write, as on a password-only account.
    const created = await vehiclesPOST(
      new Request(`${BASE}/api/vehicles`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "From the phone", type: "van" }) })
    );
    expect(created.status).toBe(201);
  });

  it("a wrong code gives no token, and the code without the pending cookie is refused", async () => {
    const first = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    const wrong = await phone("/two-factor/verify-totp", { code: "000000" }, { cookie: pendingCookie(first) });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.headers.get("set-auth-token")).toBeNull();
    expect((await phone("/two-factor/verify-totp", { code: totp(secret) })).status).toBeGreaterThanOrEqual(400);
  });

  it("the pending cookie is refused without an Origin or with a foreign one", async () => {
    const first = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    const cookie = pendingCookie(first);
    expect((await phone("/two-factor/verify-totp", { code: totp(secret) }, { cookie, origin: null })).status).toBe(403);
    expect((await phone("/two-factor/verify-totp", { code: totp(secret) }, { cookie, origin: "https://evil.test" })).status).toBe(403);
  });

  it("a backup code works once from the phone", async () => {
    const first = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    const res = await phone("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: pendingCookie(first) });
    expect(res.status).toBe(200);
    expect((await vehicles(res.headers.get("set-auth-token") ?? "")).status).toBe(200);
    const again = await phone("/sign-in/email", { email: "ann@a.test", password: PASSWORD });
    expect((await phone("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: pendingCookie(again) })).status).toBeGreaterThanOrEqual(400);
  });
});
