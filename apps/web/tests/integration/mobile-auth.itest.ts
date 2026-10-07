import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as vehiclesGET, POST as vehiclesPOST } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let token = "";

/** A phone: no cookies and no Origin header, only a bearer token. */
function phone(method: string, path: string, body?: unknown, auth: string | null = token, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (auth) headers.authorization = `Bearer ${auth}`;
  return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]);
  await createUserWithMembership({ email: "fleet@a.test", name: "Fleet", password: PASSWORD, organizationSlug: "org-a", role: "FLEET_MANAGER" });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  const [b] = await db.select().from(schema.organizations).where(sql`slug = 'org-b'`);
  await db.insert(schema.vehicles).values({ organizationId: b!.id, name: "Truck B secret" });
});

afterAll(async () => {
  await closeDb();
});

describe("phone sign-in with a bearer token", () => {
  it("signs in without cookies or an Origin header and returns a token", async () => {
    const res = await getAuth().handler(
      new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" }, body: JSON.stringify({ email: "fleet@a.test", password: PASSWORD }) })
    );
    expect(res.status).toBe(200);
    token = res.headers.get("set-auth-token") ?? "";
    expect(token.length).toBeGreaterThan(20);
  });

  it("reads and writes with the token alone, inside the user's own organization", async () => {
    const created = await vehiclesPOST(phone("POST", "/api/vehicles", { name: "From the phone", type: "van" }));
    expect(created.status).toBe(201);
    const list = await (await vehiclesGET(phone("GET", "/api/vehicles"))).json();
    expect(list.vehicles.map((v: { name: string }) => v.name)).toEqual(["From the phone"]);
  });

  it("rejects a missing, malformed or tampered token", async () => {
    expect((await vehiclesGET(phone("GET", "/api/vehicles", undefined, null))).status).toBe(401);
    expect((await vehiclesGET(phone("GET", "/api/vehicles", undefined, "not-a-token"))).status).toBe(401);
    expect((await vehiclesGET(phone("GET", "/api/vehicles", undefined, token.slice(0, -3) + "abc"))).status).toBe(401);
    expect((await vehiclesPOST(phone("POST", "/api/vehicles", { name: "X" }, null))).status).toBe(403);
  });

  it("still rejects cross-site browser requests: a bearer token does not excuse a foreign Origin or a cookie", async () => {
    expect((await vehiclesPOST(phone("POST", "/api/vehicles", { name: "X" }, token, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await vehiclesPOST(phone("POST", "/api/vehicles", { name: "X" }, token, { cookie: "rio.session_token=whatever" }))).status).toBe(403);
  });

  it("sign-out ends the token", async () => {
    const out = await getAuth().handler(new Request(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" }));
    expect(out.status).toBe(200);
    expect((await vehiclesGET(phone("GET", "/api/vehicles"))).status).toBe(401);
  });
});
