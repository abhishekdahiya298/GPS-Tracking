import "./setup-env";
import { createHash } from "node:crypto";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { GET as listGET, POST as createPOST } from "@/app/api/loads/route";
import { DELETE as loadDELETE, GET as loadGET, PATCH as loadPATCH } from "@/app/api/loads/[id]/route";
import { POST as statusPOST } from "@/app/api/loads/[id]/status/route";
import { POST as driverLinkPOST } from "@/app/api/loads/[id]/driver-link/route";
import { DELETE as shipperDELETE, POST as shipperPOST } from "@/app/api/loads/[id]/shipper-link/route";
import { POST as driverViewPOST } from "@/app/api/driver/view/route";
import { POST as driverActionPOST } from "@/app/api/driver/action/route";
import { POST as driverPosPOST } from "@/app/api/driver/positions/route";
import { POST as trackPOST } from "@/app/api/track/view/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;

// Toronto → Montreal.
const PICKUP = { name: "Acme DC", address: "100 Front St W, Toronto, ON", latitude: 43.6453, longitude: -79.3806, radiusM: 500, appointmentAt: "2026-11-02T14:00:00Z" };
const DELIVERY = { name: null, address: "1 Rue Notre-Dame, Montreal, QC", latitude: 45.5048, longitude: -73.5566, radiusM: 500, appointmentAt: null };
const north = (s: { latitude: number; longitude: number }, m: number) => ({ latitude: s.latitude + m / 111_195, longitude: s.longitude });

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.7.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
/** Public calls: no cookie, no Origin (like a phone). Each test gets its own address for the rate limit. */
const pub = (path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipN++}`, "user-agent": "DriverPhone/1.0" }, body: JSON.stringify(body) });
const tokenOf = (link: string) => link.split("#")[1]!;

const newLoad = (over: Record<string, unknown> = {}) => ({ reference: "L-100", carrierName: "Fast Freight", driverName: "Sam Driver", driverPhone: "(416) 555-0123", pickup: PICKUP, delivery: DELIVERY, ...over });
async function create(who: string, body: Record<string, unknown>) {
  const res = await createPOST(req("POST", "/api/loads", who, body));
  return { res, json: (await res.json()) as { id: string; driverLink: string; sms: unknown; error?: { code: string } } };
}
const positions = (token: string, list: { latitude: number; longitude: number; at: string; accuracyM?: number }[]) =>
  driverPosPOST(pub("/api/driver/positions", { token, positions: list.map((x) => ({ latitude: x.latitude, longitude: x.longitude, accuracyM: x.accuracyM ?? 15, recordedAt: x.at })) }));
const act = (token: string, action: string) => driverActionPOST(pub("/api/driver/action", { token, action }));
/** Fix times: seconds after the test's start (all after the driver accepts, and never in the future). */
let T0 = 0;
const iso = (secondsAfter: number) => new Date(T0 + secondsAfter * 1000).toISOString();

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Northbound Brokerage", slug: "broker-a" }, { name: "Other Broker", slug: "broker-b" }]);
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "FLEET_MANAGER" | "DISPATCHER" | "VIEWER") => createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role });
  await mk("dispatch@a.test", "broker-a", "DISPATCHER");
  await mk("viewer@a.test", "broker-a", "VIEWER");
  await mk("admin@b.test", "broker-b", "ORG_ADMIN");
  for (const [k, e] of [["dispatch", "dispatch@a.test"], ["viewer", "viewer@a.test"], ["bob", "admin@b.test"]] as const) cookies[k] = await signIn(e);
});
afterAll(async () => {
  await closeDb();
});

describe("loads: broker side", () => {
  it("dispatchers create loads; viewers cannot; phone is normalized; link is shown once", async () => {
    expect((await create("viewer", newLoad())).res.status).toBe(403);
    const { res, json } = await create("dispatch", newLoad());
    expect(res.status).toBe(201);
    expect(json.driverLink).toMatch(/^http:\/\/localhost:3000\/d#[A-Za-z0-9_-]{43}$/);
    expect(json.sms).toBeNull(); // SMS not configured in tests
    const [row] = await getDb().select().from(schema.loads).where(eq(schema.loads.id, json.id));
    expect(row!.driverPhone).toBe("+14165550123");
    expect(row!.status).toBe("invited");
    // Only the hash is stored.
    expect(row!.driverTokenHash).toBe(createHash("sha256").update(tokenOf(json.driverLink)).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(tokenOf(json.driverLink));
  });

  it("rejects a duplicate reference and a bad phone number", async () => {
    expect((await create("dispatch", newLoad())).res.status).toBe(409);
    const bad = await create("dispatch", newLoad({ reference: "L-x", driverPhone: "12345" }));
    expect(bad.res.status).toBe(400);
  });

  it("is invisible to another organization", async () => {
    const { json } = await create("dispatch", newLoad({ reference: "L-101" }));
    expect((await loadGET(req("GET", `/api/loads/${json.id}`, "bob"), p(json.id))).status).toBe(404);
    expect((await statusPOST(req("POST", `/api/loads/${json.id}/status`, "bob", { action: "cancel" }), p(json.id))).status).toBe(404);
    const list = (await (await listGET(req("GET", "/api/loads", "bob"))).json()) as { loads: unknown[] };
    expect(list.loads).toHaveLength(0);
  });
});

describe("loads: driver tracking end to end", () => {
  let id: string;
  let token: string;

  it("the driver sees who asks and for which load, and nothing is accepted before consent", async () => {
    T0 = Date.now();
    const { json } = await create("dispatch", newLoad({ reference: "L-200" }));
    id = json.id;
    token = tokenOf(json.driverLink);
    const res = await driverViewPOST(pub("/api/driver/view", { token }));
    expect(res.status).toBe(200);
    const v = (await res.json()) as Record<string, unknown>;
    expect(v).toMatchObject({ organizationName: "Northbound Brokerage", reference: "L-200", phase: "invite", pingIntervalSeconds: 120 });
    expect(JSON.stringify(v)).not.toContain("+1416");
    const before = await (await positions(token, [{ ...north(PICKUP, 5_000), at: iso(-600) }])).json();
    expect(before).toMatchObject({ accepted: 0, phase: "invite" });
  });

  it("unknown and malformed tokens get the same 404", async () => {
    for (const t of ["x", "A".repeat(43), 42]) {
      const r = await driverViewPOST(pub("/api/driver/view", { token: t }));
      expect(r.status).toBe(404);
    }
  });

  it("accepting records consent; positions then move the status automatically", async () => {
    expect(((await (await act(token, "accept")).json()) as { phase: string }).phase).toBe("sharing");
    T0 = Date.now();
    const [row] = await getDb().select().from(schema.loads).where(eq(schema.loads.id, id));
    expect(row!.acceptedAt).not.toBeNull();
    expect(row!.consentUserAgent).toBe("DriverPhone/1.0");

    // A position from before acceptance is dropped.
    expect(((await (await positions(token, [{ ...north(PICKUP, 5_000), at: iso(-3_600) }])).json()) as { accepted: number }).accepted).toBe(0);

    // Approaching, then at the pickup (sent as one queued batch, out of order).
    const r = await (await positions(token, [{ ...north(PICKUP, 100), at: iso(2) }, { ...north(PICKUP, 8_000), at: iso(1) }])).json();
    expect(r).toMatchObject({ accepted: 2, status: "at_pickup" });
    // A repeat is ignored.
    expect(((await (await positions(token, [{ ...north(PICKUP, 100), at: iso(2) }])).json()) as { accepted: number }).accepted).toBe(0);

    expect(((await (await positions(token, [{ ...north(PICKUP, 3_000), at: iso(3) }])).json()) as { status: string }).status).toBe("in_transit");

    const detail = (await (await loadGET(req("GET", `/api/loads/${id}`, "dispatch"), p(id))).json()) as { status: string; eta: { target: string } | null; events: { type: string }[]; trail: unknown[] };
    expect(detail.status).toBe("in_transit");
    expect(detail.eta?.target).toBe("delivery");
    expect(detail.trail).toHaveLength(3);
    expect(detail.events.map((e) => e.type)).toEqual(["created", "accepted", "arrived_pickup", "departed_pickup"]);
  });

  it("stop sharing pauses tracking; resuming continues it", async () => {
    expect(((await (await act(token, "stop")).json()) as { phase: string }).phase).toBe("paused");
    expect(((await (await positions(token, [{ ...north(DELIVERY, 50_000), at: iso(4) }])).json()) as { accepted: number }).accepted).toBe(0);
    const list = (await (await listGET(req("GET", "/api/loads", "dispatch"))).json()) as { loads: { reference: string; sharingStopped: boolean; eta: unknown }[] };
    const mine = list.loads.find((l) => l.reference === "L-200")!;
    expect(mine.sharingStopped).toBe(true);
    expect(mine.eta).toBeNull();
    expect(((await (await act(token, "accept")).json()) as { phase: string }).phase).toBe("sharing");
  });

  it("the shipper link shows status and position, never the driver's details", async () => {
    const sl = (await (await shipperPOST(req("POST", `/api/loads/${id}/shipper-link`, "dispatch"), p(id))).json()) as { shipperLink: string };
    expect(sl.shipperLink).toMatch(/\/track#[A-Za-z0-9_-]{43}$/);
    const st = tokenOf(sl.shipperLink);
    const v = await (await trackPOST(pub("/api/track/view", { token: st }))).json();
    expect(v).toMatchObject({ reference: "L-200", status: "in_transit", organizationName: "Northbound Brokerage" });
    const text = JSON.stringify(v);
    for (const secret of ["Sam Driver", "+14165550123", "Fast Freight"]) expect(text).not.toContain(secret);
    // The driver token is not a shipper token and vice versa.
    expect((await trackPOST(pub("/api/track/view", { token }))).status).toBe(404);
    expect((await driverViewPOST(pub("/api/driver/view", { token: st }))).status).toBe(404);
    await shipperDELETE(req("DELETE", `/api/loads/${id}/shipper-link`, "dispatch"), p(id));
    expect((await trackPOST(pub("/api/track/view", { token: st }))).status).toBe(404);
  });

  it("a new driver link replaces the old one", async () => {
    const r = (await (await driverLinkPOST(req("POST", `/api/loads/${id}/driver-link`, "dispatch", { send: false }), p(id))).json()) as { driverLink: string };
    expect((await driverViewPOST(pub("/api/driver/view", { token }))).status).toBe(404);
    token = tokenOf(r.driverLink);
    // Consent is kept: the driver is still sharing with the new link.
    expect(((await (await driverViewPOST(pub("/api/driver/view", { token }))).json()) as { phase: string }).phase).toBe("sharing");
  });

  it("arriving at and leaving the delivery ends the load; later positions are refused", async () => {
    expect(((await (await positions(token, [{ ...north(DELIVERY, 200), at: iso(5) }])).json()) as { status: string }).status).toBe("at_delivery");
    const done = (await (await positions(token, [{ ...north(DELIVERY, 2_000), at: iso(6) }])).json()) as { status: string; phase: string };
    expect(done).toMatchObject({ status: "delivered", phase: "ended" });
    expect(((await (await positions(token, [{ ...north(DELIVERY, 9_000), at: iso(7) }])).json()) as { accepted: number }).accepted).toBe(0);
    const [row] = await getDb().select().from(schema.loads).where(eq(schema.loads.id, id));
    expect(row!.endedAt).not.toBeNull();
    // Ended loads cannot be edited.
    expect((await loadPATCH(req("PATCH", `/api/loads/${id}`, "dispatch", { notes: "x" }), p(id))).status).toBe(400);
  });

  it("the ended filter lists it; deleting removes positions and timeline", async () => {
    const ended = (await (await listGET(req("GET", "/api/loads?filter=ended", "dispatch"))).json()) as { loads: { id: string }[] };
    expect(ended.loads.map((l) => l.id)).toContain(id);
    expect((await loadDELETE(req("DELETE", `/api/loads/${id}`, "dispatch"), p(id))).status).toBe(200);
    const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from load_pings where load_id = ${id}`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});

describe("loads: decline and manual outcomes", () => {
  it("a driver can decline before accepting, which ends the request", async () => {
    const { json } = await create("dispatch", newLoad({ reference: "L-300" }));
    const t = tokenOf(json.driverLink);
    expect(((await (await act(t, "decline")).json()) as { phase: string }).phase).toBe("ended");
    const d = (await (await loadGET(req("GET", `/api/loads/${json.id}`, "dispatch"), p(json.id))).json()) as { status: string };
    expect(d.status).toBe("declined");
  });

  it("the broker can mark delivered or cancel, once", async () => {
    const { json } = await create("dispatch", newLoad({ reference: "L-301" }));
    const t = tokenOf(json.driverLink);
    await act(t, "accept");
    const r = await statusPOST(req("POST", `/api/loads/${json.id}/status`, "dispatch", { action: "delivered" }), p(json.id));
    expect(((await r.json()) as { status: string }).status).toBe("delivered");
    expect((await statusPOST(req("POST", `/api/loads/${json.id}/status`, "dispatch", { action: "cancel" }), p(json.id))).status).toBe(400);
    expect(((await (await driverViewPOST(pub("/api/driver/view", { token: t }))).json()) as { phase: string }).phase).toBe("ended");
    expect((await statusPOST(req("POST", `/api/loads/${json.id}/status`, "viewer", { action: "cancel" }), p(json.id))).status).toBe(403);
  });

  it("edits update the stops and are logged on the timeline", async () => {
    const { json } = await create("dispatch", newLoad({ reference: "L-302" }));
    const r = await loadPATCH(req("PATCH", `/api/loads/${json.id}`, "dispatch", { delivery: { ...DELIVERY, radiusM: 1_000 }, driverPhone: "+1 (647) 555-0199" }), p(json.id));
    const d = (await r.json()) as { delivery: { radiusM: number }; driverPhone: string; events: { type: string }[] };
    expect(d.delivery.radiusM).toBe(1_000);
    expect(d.driverPhone).toBe("+16475550199");
    expect(d.events.at(-1)?.type).toBe("updated");
  });
});
