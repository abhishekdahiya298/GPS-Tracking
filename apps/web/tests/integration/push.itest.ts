import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { pushAlerts, pushKindForAlert, setPushTransportForTests, type PushMessage } from "@/lib/push";
import { DELETE as devDELETE, GET as devGET, POST as devPOST } from "@/app/api/push/devices/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};
let ipN = 1;
const sent: PushMessage[] = [];
const T = (n: string) => `ExponentPushToken[${n.padEnd(22, "x")}]`;

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function req(method: string, who: string | null, body?: unknown, origin: string | null = BASE) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (who) headers.cookie = cookies[who]!;
  if (origin) headers.origin = origin;
  return new Request(`${BASE}/api/push/devices`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate push_devices, audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const rows = await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a" }, { name: "Org B", slug: "org-b" }]).returning();
  orgs.a = rows[0]!.id;
  orgs.b = rows[1]!.id;
  await createUserWithMembership({ email: "ann@a.test", name: "Ann", password: PASSWORD, organizationSlug: "org-a", role: "DISPATCHER" });
  await createUserWithMembership({ email: "al@a.test", name: "Al", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "bob@b.test", name: "Bob", password: PASSWORD, organizationSlug: "org-b", role: "ORG_ADMIN" });
  for (const [k, e] of [["ann", "ann@a.test"], ["al", "al@a.test"], ["bob", "bob@b.test"]] as const) cookies[k] = await signIn(e);
  setPushTransportForTests(async (messages) => {
    sent.push(...messages);
    return messages.map((m) => ({ ok: m.to !== T("gone"), unregistered: m.to === T("gone") }));
  });
});

afterAll(async () => {
  setPushTransportForTests(null);
  await closeDb();
});

describe("push device registration", () => {
  it("needs a session, a same-site request and a real push token", async () => {
    expect((await devPOST(req("POST", null, { token: T("ann1"), platform: "ios" }))).status).toBe(401);
    expect((await devPOST(req("POST", "ann", { token: T("ann1"), platform: "ios" }, "https://evil.test"))).status).toBe(403);
    expect((await devPOST(req("POST", "ann", { token: "https://evil.test/hook", platform: "ios" }))).status).toBe(400);
    expect((await devPOST(req("POST", "ann", { token: T("ann1"), platform: "windows" }))).status).toBe(400);
  });

  it("registers a phone for the caller, updates its choices in place, and never returns the token", async () => {
    const res = await devPOST(req("POST", "ann", { token: T("ann1"), platform: "ios", organizationId: orgs.b, userId: "someone-else" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("ExponentPushToken");
    expect(body.device).toMatchObject({ platform: "ios", speeding: true, zones: true, offline: true, maintenance: false });
    await devPOST(req("POST", "ann", { token: T("ann1"), platform: "ios", zones: false }));
    await devPOST(req("POST", "al", { token: T("al1"), platform: "android", speeding: false }));
    await devPOST(req("POST", "al", { token: T("gone"), platform: "android" }));
    await devPOST(req("POST", "bob", { token: T("bob1"), platform: "ios" }));
    const mine = await (await devGET(req("GET", "ann"))).json();
    expect(mine.devices).toHaveLength(1);
    expect(mine.devices[0].zones).toBe(false);
    // The client-supplied organization was ignored.
    const rows = await getDb().select().from(schema.pushDevices).where(eq(schema.pushDevices.token, T("ann1")));
    expect(rows[0]!.organizationId).toBe(orgs.a);
  });
});

describe("alert pushes", () => {
  it("maps alert types to notification choices", () => {
    expect(pushKindForAlert("speeding")).toBe("speeding");
    expect(pushKindForAlert("geofence_exit")).toBe("zones");
    expect(pushKindForAlert("device_offline")).toBe("offline");
    expect(pushKindForAlert("ignition_on")).toBeNull();
  });

  it("reaches only the organization's phones that asked for that kind, with no position in the message", async () => {
    sent.length = 0;
    const n = await pushAlerts(orgs.a!, [
      { id: 1, type: "speeding", vehicleName: "Truck 7", ruleName: "Highway limit" },
      { id: 2, type: "geofence_exit", vehicleName: "Truck 7", ruleName: "Yard watch" },
      { id: 3, type: "ignition_on", vehicleName: "Truck 7", ruleName: "Ignition" }
    ]);
    const to = (id: number) => sent.filter((m) => m.data.alertId === id).map((m) => m.to).sort();
    expect(to(1)).toEqual([T("ann1"), T("gone")].sort()); // Al's first phone turned speeding off
    expect(to(2)).toEqual([T("al1"), T("gone")].sort()); // Ann turned zones off
    expect(to(3)).toEqual([]);
    expect(sent.some((m) => m.to === T("bob1"))).toBe(false);
    expect(n).toBe(2);
    expect(sent[0]).toMatchObject({ title: "Truck 7 is speeding", body: "Highway limit" });
    expect(JSON.stringify(sent)).not.toMatch(/lat|lon/i);
  });

  it("forgets phones the push service reports as gone, and skips people removed from the organization", async () => {
    expect(await getDb().select().from(schema.pushDevices).where(eq(schema.pushDevices.token, T("gone")))).toHaveLength(0);
    const [al] = await getDb().select().from(schema.users).where(eq(schema.users.email, "al@a.test"));
    await getDb().delete(schema.memberships).where(eq(schema.memberships.userId, al!.id));
    sent.length = 0;
    await pushAlerts(orgs.a!, [{ id: 9, type: "geofence_enter", vehicleName: null, ruleName: "Dock" }]);
    expect(sent).toEqual([]);
  });
});

describe("removing a registration", () => {
  it("removes only the caller's own phone", async () => {
    expect((await (await devDELETE(req("DELETE", "bob", { token: T("ann1") }))).json()).removed).toBe(false);
    expect((await (await devDELETE(req("DELETE", "ann", { token: T("ann1") }))).json()).removed).toBe(true);
    expect((await (await devGET(req("GET", "ann"))).json()).devices).toEqual([]);
  });
});
