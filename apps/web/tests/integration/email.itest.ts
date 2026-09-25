import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { requireTenantContext } from "@/lib/authz";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { POST as resetPOST } from "@/app/api/team/[userId]/reset-password/route";
import { POST as teamPOST } from "@/app/api/team/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let outbox: EmailMessage[] = [];
let failNext = false;
let ip = 1;
let adminCookie = "";

const auth = (path: string, body: unknown, cookie?: string) =>
  getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${ip++}`, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body)
    })
  );
async function signIn(email: string, password: string) {
  const res = await auth("/sign-in/email", { email, password });
  return { status: res.status, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const tokenFrom = (m: EmailMessage) => {
  const url = /https?:\/\/[^\s<"]+/.exec(m.text)![0];
  const u = new URL(url);
  return u.searchParams.get("token") ?? u.pathname.split("/").pop()!;
};
const req = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: adminCookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  await getDb().execute(sql`truncate audit_logs, rate_limits, sessions, accounts, verifications, memberships, users, organizations restart identity cascade`);
  await getDb().insert(schema.organizations).values([{ name: "Acme Fleet", slug: "org-a" }, { name: "Org B", slug: "org-b" }]);
  await createUserWithMembership({ email: "admin@a.test", name: "Admin", password: PASSWORD, organizationSlug: "org-a", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "driver@a.test", name: "Driver", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "VIEWER" });
  adminCookie = (await signIn("admin@a.test", PASSWORD)).cookie;
  setEmailTransportForTests(async (m) => {
    if (failNext) {
      failNext = false;
      throw new Error("provider down");
    }
    outbox.push(m);
  });
});
beforeEach(() => {
  outbox = [];
});
afterAll(async () => {
  setEmailTransportForTests(null);
  await closeDb();
});

describe("forgot password (self-service)", () => {
  it("sends one reset email for a real account and answers identically for an unknown one", async () => {
    const a = await auth("/request-password-reset", { email: "driver@a.test", redirectTo: "/reset-password" });
    const b = await auth("/request-password-reset", { email: "nobody@a.test", redirectTo: "/reset-password" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "driver@a.test", template: "password_reset" });
  });

  it("rejects a foreign redirect target", async () => {
    const r = await auth("/request-password-reset", { email: "driver@a.test", redirectTo: "https://evil.test/steal" });
    expect(r.status).toBe(403);
    expect(outbox).toHaveLength(0);
  });

  it("the link sets a new password once, revokes sessions and is audited", async () => {
    const before = await signIn("driver@a.test", PASSWORD);
    await auth("/request-password-reset", { email: "driver@a.test", redirectTo: "/reset-password" });
    const token = tokenFrom(outbox[0]!);
    const r = await auth("/reset-password", { token, newPassword: "driver-new-password-1" });
    expect(r.status).toBe(200);
    expect((await signIn("driver@a.test", PASSWORD)).status).toBe(401);
    expect((await signIn("driver@a.test", "driver-new-password-1")).status).toBe(200);
    await expect(requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie: before.cookie } }))).rejects.toMatchObject({ status: 401 });
    expect((await auth("/reset-password", { token, newPassword: "yet-another-password-2" })).status).toBe(400);
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "auth.password_reset_completed"));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(await getDb().select().from(schema.auditLogs))).not.toContain(token);
  });
});

describe("team with email enabled", () => {
  it("new member: invitation email with a set-password link, no temporary password", async () => {
    const res = await teamPOST(req("POST", "/api/team", { email: "new@a.test", name: "New Hire", role: "DISPATCHER" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ temporaryPassword: null, emailed: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "new@a.test", template: "invite" });
    expect(outbox[0]!.subject).toContain("Acme Fleet");
    expect(outbox[0]!.text).toContain("/reset-password?token=");
    const token = tokenFrom(outbox[0]!);
    expect((await auth("/reset-password", { token, newPassword: "new-hire-password-1" })).status).toBe(200);
    const s = await signIn("new@a.test", "new-hire-password-1");
    expect(s.status).toBe(200);
    const ctx = await requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie: s.cookie } }));
    expect(ctx.role).toBe("DISPATCHER");
  });

  it("existing account from another org: access email only, credentials untouched", async () => {
    const res = await teamPOST(req("POST", "/api/team", { email: "bob@b.test", name: "x", role: "VIEWER" }));
    expect(await res.json()).toMatchObject({ temporaryPassword: null, emailed: true });
    expect(outbox[0]).toMatchObject({ to: "bob@b.test", template: "access_granted" });
    expect(outbox[0]!.text).not.toContain("token");
    expect((await signIn("bob@b.test", PASSWORD)).status).toBe(200);
  });

  it("admin reset: emails a link and the old password stops working immediately", async () => {
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "new@a.test"));
    const res = await resetPOST(req("POST", `/api/team/${u!.id}/reset-password`), { params: Promise.resolve({ userId: u!.id }) });
    expect(await res.json()).toMatchObject({ temporaryPassword: null, emailed: true });
    expect((await signIn("new@a.test", "new-hire-password-1")).status).toBe(401);
    expect(outbox[0]).toMatchObject({ to: "new@a.test", template: "password_reset" });
    expect((await auth("/reset-password", { token: tokenFrom(outbox[0]!), newPassword: "after-admin-reset-1" })).status).toBe(200);
    expect((await signIn("new@a.test", "after-admin-reset-1")).status).toBe(200);
  });

  it("if the email provider fails, falls back to a one-time temporary password", async () => {
    failNext = true;
    const res = await teamPOST(req("POST", "/api/team", { email: "late@a.test", name: "Late", role: "VIEWER" }));
    const body = await res.json();
    expect(body.emailed).toBe(false);
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect((await signIn("late@a.test", body.temporaryPassword)).status).toBe(200);
  });
});
