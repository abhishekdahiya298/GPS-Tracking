import "./setup-env";
import { locationChannel } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { and, eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership, ProvisioningError } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { requirePermission, requireTenantContext } from "@/lib/authz";
import { GET as streamGET } from "@/app/api/locations/stream/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let orgA: string;
let orgB: string;
let publisher: Redis;

async function authCall(path: string, body: unknown, headers: Record<string, string> = {}) {
  return getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": headers.ip ?? "203.0.113.10", ...headers },
      body: JSON.stringify(body)
    })
  );
}

/** Signs in and returns the Cookie header value for subsequent requests. */
async function signIn(email: string, ip = "203.0.113.10"): Promise<string> {
  const res = await authCall("/sign-in/email", { email, password: PASSWORD }, { ip });
  expect(res.status).toBe(200);
  const setCookie = res.headers.getSetCookie();
  const token = setCookie.find((c) => c.startsWith("rio.session_token="));
  expect(token, "session cookie set").toBeTruthy();
  expect(token).toMatch(/HttpOnly/i);
  expect(token).toMatch(/SameSite=Lax/i);
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

function req(path: string, cookie?: string, extra: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...extra } });
}

/** Reads SSE chunks until `predicate` matches or timeout; returns all text read. */
async function readSse(res: Response, ms: number): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())))
    ]);
    if (!r || r.done) break;
    text += dec.decode(r.value);
  }
  await reader.cancel();
  return text;
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(
    sql`truncate audit_logs, rate_limits, sessions, accounts, verifications, memberships, current_locations, device_assignments, gps_devices, gps_providers, vehicles, users, organizations restart identity cascade`
  );
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "VIEWER" | "DISPATCHER", superAdmin = false) =>
    createUserWithMembership({ email, name: email, password: PASSWORD, organizationSlug: slug, role, superAdmin });
  await mk("alice@a.test", "org-a", "ORG_ADMIN");
  await mk("bob@b.test", "org-b", "VIEWER");
  await mk("dave@a.test", "org-a", "DISPATCHER");
  await mk("root@platform.test", "org-a", "VIEWER", true);
  // Carol: a real account with no membership anywhere.
  await mk("carol@none.test", "org-b", "VIEWER");
  const [carol] = await db.select().from(schema.users).where(eq(schema.users.email, "carol@none.test"));
  await db.delete(schema.memberships).where(eq(schema.memberships.userId, carol!.id));
  publisher = new Redis(process.env.TEST_REDIS_URL!);
});

afterAll(async () => {
  publisher?.disconnect();
  await closeDb();
});

describe("provisioning", () => {
  it("refuses duplicate emails and short passwords", async () => {
    await expect(
      createUserWithMembership({ email: "ALICE@a.test", name: "x", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" })
    ).rejects.toBeInstanceOf(ProvisioningError);
    await expect(
      createUserWithMembership({ email: "new@a.test", name: "x", password: "short", organizationSlug: "org-a", role: "VIEWER" })
    ).rejects.toThrow();
  });

  it("stores a hashed password, never plaintext", async () => {
    const rows = await getDb().select({ password: schema.accounts.password }).from(schema.accounts);
    for (const r of rows) {
      expect(r.password).not.toContain(PASSWORD);
      expect(r.password!.length).toBeGreaterThan(40);
    }
  });

  it("audits user creation", async () => {
    const rows = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "user.created"));
    expect(rows.length).toBe(5);
  });
});

describe("authentication", () => {
  it("public sign-up is disabled", async () => {
    const res = await authCall("/sign-up/email", { email: "mallory@x.test", password: PASSWORD, name: "m" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "mallory@x.test"));
    expect(u).toBeUndefined();
  });

  it("isSuperAdmin cannot be set through the API", async () => {
    const res = await authCall("/sign-up/email", { email: "eve@x.test", password: PASSWORD, name: "e", isSuperAdmin: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a wrong password with a generic 401 and audits it", async () => {
    const res = await authCall("/sign-in/email", { email: "alice@a.test", password: "wrong-password-123" }, { ip: "198.51.100.1" });
    expect(res.status).toBe(401);
    const rows = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "auth.login_failed"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toContain("wrong-password-123");
  });

  it("an unknown email gets the same 401 as a wrong password", async () => {
    const res = await authCall("/sign-in/email", { email: "nobody@x.test", password: PASSWORD }, { ip: "198.51.100.2" });
    expect(res.status).toBe(401);
  });

  it("rate-limits sign-in attempts per IP (5/min)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await authCall("/sign-in/email", { email: "alice@a.test", password: "wrong-password-123" }, { ip: "192.0.2.77" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("rejects sign-in from an untrusted Origin", async () => {
    const res = await authCall("/sign-in/email", { email: "alice@a.test", password: PASSWORD }, { origin: "https://evil.test", ip: "192.0.2.90" });
    expect(res.status).toBe(403);
  });

  it("signs in, audits the login, and sign-out revokes the session", async () => {
    const cookie = await signIn("alice@a.test", "192.0.2.10");
    const ctx = await requireTenantContext(req("/x", cookie));
    expect(ctx.organizationId).toBe(orgA);

    const logins = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "auth.login"));
    expect(logins.length).toBeGreaterThanOrEqual(1);

    const out = await getAuth().handler(
      new Request(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json" }, body: "{}" })
    );
    expect(out.status).toBe(200);
    await expect(requireTenantContext(req("/x", cookie))).rejects.toMatchObject({ status: 401 });
  });

  it("a forged session cookie is rejected", async () => {
    await expect(requireTenantContext(req("/x", "rio.session_token=forged.value"))).rejects.toMatchObject({ status: 401 });
  });
});

describe("tenant isolation", () => {
  it("derives the organization from memberships, ignoring client-supplied org ids", async () => {
    const cookie = await signIn("bob@b.test", "192.0.2.11");
    const ctx = await requireTenantContext(
      req(`/x?organizationId=${orgA}`, cookie, { "x-organization-id": orgA, "x-rio-org": orgA })
    );
    expect(ctx.organizationId).toBe(orgB);
    expect(ctx.role).toBe("VIEWER");
  });

  it("a session's activeOrganizationId for a foreign org does not grant access", async () => {
    const cookie = await signIn("bob@b.test", "192.0.2.12");
    // Simulate a tampered/stale session row pointing at Org A.
    const [bob] = await getDb().select().from(schema.users).where(eq(schema.users.email, "bob@b.test"));
    await getDb().update(schema.sessions).set({ activeOrganizationId: orgA }).where(eq(schema.sessions.userId, bob!.id));
    const ctx = await requireTenantContext(req("/x", cookie));
    expect(ctx.organizationId).toBe(orgB);
  });

  it("a user with no membership is forbidden", async () => {
    const cookie = await signIn("carol@none.test", "192.0.2.13");
    await expect(requireTenantContext(req("/x", cookie))).rejects.toMatchObject({ status: 403 });
  });

  it("RBAC: VIEWER cannot manage users; ORG_ADMIN can; DISPATCHER cannot assign devices", async () => {
    const bob = await requireTenantContext(req("/x", await signIn("bob@b.test", "192.0.2.14")));
    expect(() => requirePermission(bob, "users.manage")).toThrowError(expect.objectContaining({ status: 403 }));
    const alice = await requireTenantContext(req("/x", await signIn("alice@a.test", "192.0.2.15")));
    expect(() => requirePermission(alice, "users.manage")).not.toThrow();
    const dave = await requireTenantContext(req("/x", await signIn("dave@a.test", "192.0.2.16")));
    expect(() => requirePermission(dave, "devices.assign")).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("SSE: unauthenticated → 401, no membership → 403", async () => {
    expect((await streamGET(req("/api/locations/stream"))).status).toBe(401);
    const carol = await signIn("carol@none.test", "192.0.2.17");
    expect((await streamGET(req("/api/locations/stream", carol))).status).toBe(403);
  });

  it("SSE: Org A's stream receives Org A events and never Org B events", async () => {
    const cookie = await signIn("alice@a.test", "192.0.2.18");
    const ac = new AbortController();
    const res = await streamGET(new Request(`${BASE}/api/locations/stream?organizationId=${orgB}`, { headers: { cookie }, signal: ac.signal }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reading = readSse(res, 1500);
    await new Promise((r) => setTimeout(r, 300));
    await publisher.publish(locationChannel(orgB), JSON.stringify({ marker: "ORG_B_SECRET" }));
    await publisher.publish(locationChannel(orgA), JSON.stringify({ marker: "ORG_A_EVENT" }));
    const text = await reading;
    ac.abort();
    expect(text).toContain("ORG_A_EVENT");
    expect(text).not.toContain("ORG_B_SECRET");
  });

  it("membership rows are unique per (user, organization)", async () => {
    const [alice] = await getDb().select().from(schema.users).where(eq(schema.users.email, "alice@a.test"));
    await expect(
      getDb().insert(schema.memberships).values({ userId: alice!.id, organizationId: orgA, role: "VIEWER" })
    ).rejects.toThrow();
    const rows = await getDb()
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, alice!.id), eq(schema.memberships.organizationId, orgA)));
    expect(rows).toHaveLength(1);
  });
});
