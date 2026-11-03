import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as versionGET } from "@/app/api/app/version/route";
import { PUT as releasePUT } from "@/app/api/admin/app-releases/[platform]/route";
import { GET as vehiclesGET } from "@/app/api/vehicles/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.11.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const check = async (platform: string, version: string) => (await versionGET(new Request(`${BASE}/api/app/version?platform=${platform}&version=${version}`))).json();
const put = (who: string, platform: string, body: unknown) => releasePUT(req("PUT", `/api/admin/app-releases/${platform}`, who, body), { params: Promise.resolve({ platform }) });

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, app_releases restart identity cascade`);
  await db.insert(schema.organizations).values({ name: "Fleet Co", slug: "fleet" });
  await createUserWithMembership({ email: "admin@fleet.test", name: "Admin", password: PASSWORD, organizationSlug: "fleet", role: "ORG_ADMIN" });
  await createUserWithMembership({ email: "root@rio.test", name: "Root", password: PASSWORD, organizationSlug: "fleet", role: "VIEWER" });
  await db.update(schema.users).set({ isSuperAdmin: true }).where(eq(schema.users.email, "root@rio.test"));
  cookies.admin = await signIn("admin@fleet.test");
  cookies.root = await signIn("root@rio.test");
});
afterAll(async () => {
  await closeDb();
});

describe("mobile app updates", () => {
  it("with nothing set, every version is current", async () => {
    expect(await check("android", "0.1.0")).toMatchObject({ status: "current" });
  });

  it("only platform admins set the policy; it is validated", async () => {
    expect((await put("admin", "android", { latestVersion: "1.4.0", minVersion: "1.3.0", updateUrl: "https://play.google.com/store/apps/details?id=com.riogps.app", notes: "" })).status).toBe(403);
    expect((await put("root", "android", { latestVersion: "1.2.0", minVersion: "1.3.0", updateUrl: "https://x.test", notes: "" })).status).toBe(400); // required newer than latest
    expect((await put("root", "android", { latestVersion: "1.4.0", minVersion: "", updateUrl: "", notes: "" })).status).toBe(400); // no link
    expect((await put("root", "windows", { latestVersion: "1.4.0", minVersion: "", updateUrl: "https://x.test", notes: "" })).status).toBe(404);
    expect((await put("root", "android", { latestVersion: "1.4.0", minVersion: "1.3.0", updateUrl: "https://play.google.com/store/apps/details?id=com.riogps.app", notes: "Faster map" })).status).toBe(204);
  });

  it("tells each app whether it may or must update, per platform", async () => {
    expect(await check("android", "1.2.9")).toMatchObject({ status: "required", minVersion: "1.3.0", updateUrl: expect.stringContaining("play.google.com"), notes: "Faster map" });
    expect(await check("android", "1.3.0")).toMatchObject({ status: "optional", latestVersion: "1.4.0" });
    expect(await check("android", "1.4.0")).toMatchObject({ status: "current" });
    expect(await check("ios", "0.1.0")).toMatchObject({ status: "current" });
    expect((await versionGET(new Request(`${BASE}/api/app/version?platform=android`))).status).toBe(400);
  });

  it("the API refuses too-old apps with 426; the website and newer apps are unaffected", async () => {
    const old = await vehiclesGET(req("GET", "/api/vehicles", "admin", undefined, { "x-rio-app-version": "1.2.0", "x-rio-app-platform": "android" }));
    expect(old.status).toBe(426);
    expect((await old.json()).error?.code ?? "UPDATE_REQUIRED").toBe("UPDATE_REQUIRED");
    expect((await vehiclesGET(req("GET", "/api/vehicles", "admin", undefined, { "x-rio-app-version": "1.3.0", "x-rio-app-platform": "android" }))).status).toBe(200);
    expect((await vehiclesGET(req("GET", "/api/vehicles", "admin"))).status).toBe(200);
  });
});
