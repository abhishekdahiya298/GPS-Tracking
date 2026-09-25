import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { requireTenantContext } from "@/lib/authz";
import { POST as resetPOST } from "@/app/api/team/[userId]/reset-password/route";
import { DELETE as memberDELETE, PATCH as memberPATCH } from "@/app/api/team/[userId]/route";
import { GET as teamGET, POST as teamPOST } from "@/app/api/team/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let ipN = 1;

async function signInRaw(email: string, password: string) {
  return getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.51.100.${ipN++}` },
      body: JSON.stringify({ email, password })
    })
  );
}
async function signIn(email: string, password = PASSWORD) {
  const res = await signInRaw(email, password);
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function req(method: string, path: string, who: string, body?: unknown, origin: string | null = BASE) {
  const headers: Record<string, string> = { cookie: cookies[who]!, "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const p = (userId: string) => ({ params: Promise.resolve({ userId }) });
const uid = async (email: string) => (await getDb().select().from(schema.users).where(eq(schema.users.email, email)))[0]!.id;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]);
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "VIEWER", superAdmin = false) =>
    createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role, superAdmin });
  await mk("admin@a.test", "org-a", "ORG_ADMIN");
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("bob@b.test", "org-b", "ORG_ADMIN");
  await mk("root@platform.test", "org-a", "VIEWER", true);
  for (const [k, e] of [["admin", "admin@a.test"], ["fleet", "fleet@a.test"], ["viewer", "viewer@a.test"], ["bob", "bob@b.test"]] as const) {
    cookies[k] = await signIn(e);
    ids[k] = await uid(e);
  }
  ids.root = await uid("root@platform.test");
});

afterAll(async () => {
  await closeDb();
});

describe("team: read", () => {
  it("VIEWER cannot list members; FLEET_MANAGER can read but not manage", async () => {
    expect((await teamGET(req("GET", "/api/team", "viewer"))).status).toBe(403);
    const res = await teamGET(req("GET", "/api/team", "fleet"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members.map((m: { email: string }) => m.email).sort()).toEqual(["admin@a.test", "fleet@a.test", "root@platform.test", "viewer@a.test"]);
    expect(JSON.stringify(body)).not.toContain("bob@b.test");
    expect((await teamPOST(req("POST", "/api/team", "fleet", { email: "x@a.test", name: "x", role: "VIEWER" }))).status).toBe(403);
  });
});

describe("team: add", () => {
  let tmp: string;
  it("adds a brand-new member with a one-time temporary password that works", async () => {
    const res = await teamPOST(req("POST", "/api/team", "admin", { email: "  New@A.test ", name: "New Person", role: "DISPATCHER" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    tmp = body.temporaryPassword;
    expect(tmp).toMatch(/^[A-Za-z0-9]{20}$/);
    const cookie = await signIn("new@a.test", tmp);
    const ctx = await requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie } }));
    expect(ctx.role).toBe("DISPATCHER");
  });

  it("never writes the temporary password to the audit log", async () => {
    const rows = await getDb().select().from(schema.auditLogs);
    expect(JSON.stringify(rows)).not.toContain(tmp);
    expect(rows.some((r) => r.action === "member.added")).toBe(true);
  });

  it("adding an existing account from another org grants access without touching its credentials", async () => {
    const res = await teamPOST(req("POST", "/api/team", "admin", { email: "bob@b.test", name: "Ignored Name", role: "VIEWER" }));
    expect(res.status).toBe(201);
    expect((await res.json()).temporaryPassword).toBeNull();
    const [bob] = await getDb().select().from(schema.users).where(eq(schema.users.id, ids.bob!));
    expect(bob!.name).toBe("bob");
    await signIn("bob@b.test"); // old password still valid
    expect((await teamPOST(req("POST", "/api/team", "admin", { email: "bob@b.test", name: "x", role: "VIEWER" }))).status).toBe(409);
  });

  it("validates input and enforces CSRF", async () => {
    expect((await teamPOST(req("POST", "/api/team", "admin", { email: "nope", name: "x", role: "VIEWER" }))).status).toBe(400);
    expect((await teamPOST(req("POST", "/api/team", "admin", { email: "a@b.co", name: "x", role: "SUPER_ADMIN" }))).status).toBe(400);
    expect((await teamPOST(req("POST", "/api/team", "admin", { email: "a@b.co", name: "x", role: "VIEWER" }, null))).status).toBe(403);
  });
});

describe("team: roles and removal", () => {
  it("an organization can never lose its last Org Admin", async () => {
    expect((await memberPATCH(req("PATCH", `/api/team/${ids.admin}`, "admin", { role: "VIEWER" }), p(ids.admin!))).status).toBe(409);
    expect((await memberDELETE(req("DELETE", `/api/team/${ids.admin}`, "admin"), p(ids.admin!))).status).toBe(409);
    // With a second admin it becomes possible.
    expect((await memberPATCH(req("PATCH", `/api/team/${ids.fleet}`, "admin", { role: "ORG_ADMIN" }), p(ids.fleet!))).status).toBe(200);
    expect((await memberPATCH(req("PATCH", `/api/team/${ids.fleet}`, "admin", { role: "FLEET_MANAGER" }), p(ids.fleet!))).status).toBe(200);
  });

  it("a user in another org is a 404 for every mutation", async () => {
    // bob now also belongs to org A (added above), so use an org-B-only user:
    await getDb().insert(schema.users).values({ email: "carol@b.test", name: "carol" });
    const carol = await uid("carol@b.test");
    const [orgB] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.slug, "org-b"));
    await getDb().insert(schema.memberships).values({ userId: carol, organizationId: orgB!.id, role: "VIEWER" });
    expect((await memberPATCH(req("PATCH", `/api/team/${carol}`, "admin", { role: "ORG_ADMIN" }), p(carol))).status).toBe(404);
    expect((await memberDELETE(req("DELETE", `/api/team/${carol}`, "admin"), p(carol))).status).toBe(404);
    expect((await resetPOST(req("POST", `/api/team/${carol}/reset-password`, "admin"), p(carol))).status).toBe(404);
  });

  it("removal revokes the member's sessions immediately", async () => {
    const viewerCookie = cookies.viewer!;
    expect((await memberDELETE(req("DELETE", `/api/team/${ids.viewer}`, "admin"), p(ids.viewer!))).status).toBe(204);
    await expect(requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie: viewerCookie } }))).rejects.toMatchObject({ status: 401 });
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "member.removed"));
    expect(audit[0]?.targetId).toBe(ids.viewer);
  });
});

describe("team: password reset", () => {
  it("resets an org-only member: old password stops working, new one works, sessions revoked", async () => {
    const fleetCookie = cookies.fleet!;
    const res = await resetPOST(req("POST", `/api/team/${ids.fleet}/reset-password`, "admin"), p(ids.fleet!));
    expect(res.status).toBe(200);
    const { temporaryPassword } = await res.json();
    await expect(requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie: fleetCookie } }))).rejects.toMatchObject({ status: 401 });
    expect((await signInRaw("fleet@a.test", PASSWORD)).status).toBe(401);
    await signIn("fleet@a.test", temporaryPassword);
    const rows = await getDb().select().from(schema.auditLogs);
    expect(JSON.stringify(rows)).not.toContain(temporaryPassword);
  });

  it("refuses to reset an account that also belongs to another organization", async () => {
    const res = await resetPOST(req("POST", `/api/team/${ids.bob}/reset-password`, "admin"), p(ids.bob!));
    expect(res.status).toBe(403);
    await signIn("bob@b.test"); // untouched
  });

  it("refuses to reset a platform super admin (non-super actor)", async () => {
    expect((await resetPOST(req("POST", `/api/team/${ids.root}/reset-password`, "admin"), p(ids.root!))).status).toBe(403);
  });
});

describe("account: change own password", () => {
  it("changes the password via Better Auth, signs other sessions out, and audits it", async () => {
    const userId = await uid("new@a.test");
    const reset = await resetPOST(req("POST", `/api/team/${userId}/reset-password`, "admin"), p(userId));
    const current = (await reset.json()).temporaryPassword as string;
    const other = await signIn("new@a.test", current);
    const mine = await signIn("new@a.test", current);

    const res = await getAuth().handler(
      new Request(`${BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { cookie: mine, origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: "a-brand-new-password-123", revokeOtherSessions: true })
      })
    );
    expect(res.status).toBe(200);
    expect((await signInRaw("new@a.test", current)).status).toBe(401);
    await signIn("new@a.test", "a-brand-new-password-123");
    await expect(requireTenantContext(new Request(`${BASE}/x`, { headers: { cookie: other } }))).rejects.toMatchObject({ status: 401 });
    const audit = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "auth.password_changed"));
    expect(audit[0]?.actorUserId).toBe(userId);
  });

  it("rejects a wrong current password", async () => {
    const cookie = await signIn("new@a.test", "a-brand-new-password-123");
    const res = await getAuth().handler(
      new Request(`${BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { cookie, origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "wrong-password-xyz", newPassword: "another-new-password-1" })
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    await signIn("new@a.test", "a-brand-new-password-123");
  });
});
