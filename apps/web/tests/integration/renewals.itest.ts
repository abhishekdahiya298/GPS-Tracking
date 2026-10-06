import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { listRenewals, renewalCounts, runRenewalCheck } from "@/lib/renewals";
import { GET as renewalsGET, POST as renewalsPOST } from "@/app/api/renewals/route";
import { DELETE as renewalDELETE, PATCH as renewalPATCH } from "@/app/api/renewals/[id]/route";
import { POST as renewPOST } from "@/app/api/renewals/[id]/renew/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;
let orgA: string, orgB: string, vA: string, vB: string, fleetId: string, bobId: string;
// Oct 5, 2026, 11 PM in Toronto (already Oct 6 in UTC): "today" must be Oct 5 for Org A.
const NOW = new Date("2026-10-06T03:00:00Z");

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.8.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown, origin = BASE) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const create = async (who: string, body: Record<string, unknown>) => renewalsPOST(req("POST", "/api/renewals", who, body));
const userId = async (email: string) => (await getDb().select().from(schema.users).where(eq(schema.users.email, email)))[0]!.id;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a, b] = await db.insert(schema.organizations).values([{ name: "Org A", slug: "org-a", timeZone: "America/Toronto" }, { name: "Org B", slug: "org-b", timeZone: "UTC" }]).returning();
  orgA = a!.id;
  orgB = b!.id;
  vA = (await db.insert(schema.vehicles).values({ organizationId: orgA, name: "Truck A" }).returning())[0]!.id;
  vB = (await db.insert(schema.vehicles).values({ organizationId: orgB, name: "Truck B" }).returning())[0]!.id;
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "VIEWER") => createUserWithMembership({ email, name: email, password: PASSWORD, organizationSlug: slug, role });
  await mk("fleet@a.test", "org-a", "FLEET_MANAGER");
  await mk("viewer@a.test", "org-a", "VIEWER");
  await mk("admin@b.test", "org-b", "ORG_ADMIN");
  fleetId = await userId("fleet@a.test");
  bobId = await userId("admin@b.test");
  for (const [k, e] of [["fleet", "fleet@a.test"], ["viewer", "viewer@a.test"], ["bob", "admin@b.test"]] as const) cookies[k] = await signIn(e);
});
afterAll(async () => {
  await closeDb();
});

describe("renewal reminders", () => {
  let insurance: string;

  it("fleet managers create; viewers read only; validation", async () => {
    expect((await create("viewer", { type: "insurance", title: "Policy", dueDate: "2026-10-20" })).status).toBe(403);
    expect((await renewalsPOST(req("POST", "/api/renewals", "fleet", { type: "insurance", title: "Policy", dueDate: "2026-10-20" }, "https://evil.example"))).status).toBe(403);
    expect((await create("fleet", { type: "fuel", title: "x", dueDate: "2026-10-20" })).status).toBe(400);
    expect((await create("fleet", { type: "insurance", title: "x", dueDate: "2026-02-30" })).status).toBe(400); // not a real date
    expect((await create("fleet", { type: "insurance", title: "x", dueDate: "20/10/2026" })).status).toBe(400);
    expect((await create("fleet", { type: "insurance", title: "", dueDate: "2026-10-20" })).status).toBe(400);
    const res = await create("fleet", { type: "insurance", title: "Fleet policy", dueDate: "2026-10-20", remindDays: 30, vehicleId: null, notifyUserIds: [fleetId] });
    expect(res.status).toBe(201);
    insurance = (await res.json()).id;
    expect((await create("fleet", { type: "registration", title: "Plate sticker", dueDate: "2026-10-05", remindDays: 14, vehicleId: vA })).status).toBe(201);
    expect((await create("fleet", { type: "inspection", title: "Annual safety", dueDate: "2026-10-04", vehicleId: vA })).status).toBe(201);
    expect((await create("fleet", { type: "permit", title: "Oversize permit", dueDate: "2027-06-30" })).status).toBe(201);
    expect((await renewalsGET(req("GET", "/api/renewals", "viewer"))).status).toBe(200);
  });

  it("state uses the organization's calendar day, soonest first", async () => {
    const list = await listRenewals(orgA, NOW); // Oct 5 in Toronto
    expect(list.map((r) => [r.title, r.status.state, r.status.daysRemaining])).toEqual([
      ["Annual safety", "overdue", -1],
      ["Plate sticker", "due_soon", 0], // still valid on its last day
      ["Fleet policy", "due_soon", 15],
      ["Oversize permit", "ok", 268]
    ]);
    expect(list[1]).toMatchObject({ vehicleName: "Truck A" });
    expect(list[2]).toMatchObject({ vehicleName: null });
    expect(await renewalCounts(orgA, NOW)).toEqual({ overdue: 1, dueSoon: 2 });
    // The same instant is already Oct 6 for a UTC organization.
    await getDb().insert(schema.renewalReminders).values({ organizationId: orgB, type: "permit", title: "B permit", dueDate: "2026-10-05" });
    expect((await listRenewals(orgB, NOW))[0]!.status).toEqual({ state: "overdue", daysRemaining: -1 });
  });

  it("tenant isolation: foreign vehicles/recipients rejected, foreign renewals invisible", async () => {
    expect((await create("fleet", { type: "permit", title: "x", dueDate: "2026-12-01", vehicleId: vB })).status).toBe(400);
    expect((await create("fleet", { type: "permit", title: "x", dueDate: "2026-12-01", notifyUserIds: [bobId] })).status).toBe(400);
    expect((await renewalPATCH(req("PATCH", `/api/renewals/${insurance}`, "bob", { title: "Hacked" }), params(insurance))).status).toBe(404);
    expect((await renewalDELETE(req("DELETE", `/api/renewals/${insurance}`, "bob"), params(insurance))).status).toBe(404);
    expect((await renewPOST(req("POST", `/api/renewals/${insurance}/renew`, "bob", { dueDate: "2028-01-01" }), params(insurance))).status).toBe(404);
    const theirs = (await (await renewalsGET(req("GET", "/api/renewals", "bob"))).json()).renewals;
    expect(theirs.map((r: { title: string }) => r.title)).toEqual(["B permit"]);
  });

  it("the scheduler claims each state change once (email is off in tests, so due states stay pending)", async () => {
    // With email disabled the pass must not mark due_soon/overdue as notified...
    expect(await runRenewalCheck(NOW)).toBe(0);
    const rows = await getDb().select().from(schema.renewalReminders).where(eq(schema.renewalReminders.organizationId, orgA));
    expect(rows.every((r) => r.notifiedState === null)).toBe(true);
  });

  it("mark renewed: later date required, reminders start over, audited", async () => {
    expect((await renewPOST(req("POST", `/api/renewals/${insurance}/renew`, "viewer", { dueDate: "2027-10-20" }), params(insurance))).status).toBe(403);
    expect((await renewPOST(req("POST", `/api/renewals/${insurance}/renew`, "fleet", { dueDate: "2026-10-20" }), params(insurance))).status).toBe(400);
    await getDb().update(schema.renewalReminders).set({ notifiedState: "due_soon" }).where(eq(schema.renewalReminders.id, insurance));
    expect((await renewPOST(req("POST", `/api/renewals/${insurance}/renew`, "fleet", { dueDate: "2027-10-20" }), params(insurance))).status).toBe(200);
    const [row] = await getDb().select().from(schema.renewalReminders).where(eq(schema.renewalReminders.id, insurance));
    expect(row).toMatchObject({ dueDate: "2027-10-20", notifiedState: null });
    expect(row!.lastRenewedAt).not.toBeNull();
    const [audit] = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "renewal.renewed"));
    expect(audit!.metadata).toEqual({ from: "2026-10-20", to: "2027-10-20" });
    expect((await listRenewals(orgA, NOW)).find((r) => r.id === insurance)!.status.state).toBe("ok");
  });

  it("edit and delete", async () => {
    expect((await renewalPATCH(req("PATCH", `/api/renewals/${insurance}`, "fleet", { title: "Fleet insurance", remindDays: 60, vehicleId: vA }), params(insurance))).status).toBe(200);
    expect((await renewalPATCH(req("PATCH", `/api/renewals/${insurance}`, "fleet", { vehicleId: vB }), params(insurance))).status).toBe(400);
    expect((await renewalPATCH(req("PATCH", `/api/renewals/${insurance}`, "fleet", {}), params(insurance))).status).toBe(400);
    expect((await listRenewals(orgA, NOW)).find((r) => r.id === insurance)).toMatchObject({ title: "Fleet insurance", remindDays: 60, vehicleName: "Truck A" });
    expect((await renewalDELETE(req("DELETE", `/api/renewals/${insurance}`, "viewer"), params(insurance))).status).toBe(403);
    expect((await renewalDELETE(req("DELETE", `/api/renewals/${insurance}`, "fleet"), params(insurance))).status).toBe(200);
    expect((await renewalDELETE(req("DELETE", `/api/renewals/${insurance}`, "fleet"), params(insurance))).status).toBe(404);
    // Deleting a vehicle removes its renewals but not company-wide ones.
    await getDb().delete(schema.vehicles).where(eq(schema.vehicles.id, vA));
    expect((await listRenewals(orgA, NOW)).map((r) => r.title)).toEqual(["Oversize permit"]);
  });
});
