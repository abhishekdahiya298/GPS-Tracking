import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";
import { runPaperworkReminders } from "@/lib/paperwork";
import { POST as createPOST } from "@/app/api/loads/route";
import { POST as statusPOST } from "@/app/api/loads/[id]/status/route";
import { GET as pwGET, PUT as pwPUT } from "@/app/api/loads/[id]/paperwork/route";
import { POST as docPOST } from "@/app/api/loads/[id]/documents/route";
import { DELETE as docDELETE, GET as docGET } from "@/app/api/loads/[id]/documents/[docId]/route";
import { GET as packetGET, POST as packetPOST } from "@/app/api/loads/[id]/packet/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/organization/paperwork/route";
import { GET as driverPwGET, POST as driverPwPOST } from "@/app/api/driver-app/loads/[id]/paperwork/route";
import { driverPhone } from "./driver-app-client";
import { GET as lookupGET } from "@/app/api/drivers/lookup/route";
import { listPlatformDrivers } from "@/lib/platform-drivers";
import { listPlans } from "@/lib/plans";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const cookies: Record<string, string> = {};
let ipN = 1;
const PICKUP = { name: "Acme DC", address: "100 Front St W, Toronto, ON", latitude: 43.6453, longitude: -79.3806, radiusM: 500, appointmentAt: null };
const DELIVERY = { name: "Metro", address: "1 Rue Notre-Dame, Montreal, QC", latitude: 45.5048, longitude: -73.5566, radiusM: 500, appointmentAt: null };
// A 1×1 PNG and a tiny PDF.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const outbox: EmailMessage[] = [];

async function signIn(email: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `198.18.9.${ipN++}` }, body: JSON.stringify({ email, password: PASSWORD }) })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const req = (method: string, path: string, who: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { cookie: cookies[who]!, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
const upload = (path: string, headers: Record<string, string>, fields: Record<string, string>, file: Buffer, name = "bol.png") => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set("file", new Blob([new Uint8Array(file)]), name);
  return new Request(`${BASE}${path}`, { method: "POST", headers, body: fd });
};
const p = (id: string) => ({ params: Promise.resolve({ id }) });

let loadId = "";
const phone = driverPhone();

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values([{ name: "Northbound Freight", slug: "pw-a" }, { name: "Other Co", slug: "pw-b" }]);
  const mk = (email: string, slug: string, role: "ORG_ADMIN" | "DISPATCHER" | "VIEWER") => createUserWithMembership({ email, name: email.split("@")[0]!, password: PASSWORD, organizationSlug: slug, role });
  await mk("admin@pw.test", "pw-a", "ORG_ADMIN");
  await mk("dispatch@pw.test", "pw-a", "DISPATCHER");
  await mk("other@pw.test", "pw-b", "ORG_ADMIN");
  for (const [k, e] of [["admin", "admin@pw.test"], ["dispatch", "dispatch@pw.test"], ["other", "other@pw.test"]] as const) cookies[k] = await signIn(e);
  setEmailTransportForTests(async (m) => {
    outbox.push(m);
  });
});
afterAll(async () => {
  setEmailTransportForTests(null);
  await closeDb();
});

describe("load paperwork", () => {
  it("companies start with the RIO GPS list and can change it; dispatchers can't", async () => {
    const g = (await (await settingsGET(req("GET", "/api/organization/paperwork", "dispatch"))).json()) as { settings: { items: { key: string; mode: string }[]; sendWhen: string } };
    expect(g.settings.items.find((i) => i.key === "delivery_pod")?.mode).toBe("required");
    expect(g.settings.sendWhen).toBe("delivered");
    const items = g.settings.items.map((i) => (i.key === "pickup_seal" ? { ...i, mode: "required" } : i));
    expect((await settingsPUT(req("PUT", "/api/organization/paperwork", "dispatch", { items, recipients: [], toCreator: true, sendWhen: "manual" }))).status).toBe(403);
    const r = await settingsPUT(req("PUT", "/api/organization/paperwork", "admin", { items, recipients: ["billing@northbound.test"], toCreator: true, sendWhen: "manual" }));
    expect(r.status).toBe(200);
  });

  it("a load uses the company list, can change it, and counts what is missing once the stop is reached", async () => {
    const res = await createPOST(req("POST", "/api/loads", "dispatch", { reference: "PW-1", driverName: "Sam", driverPhone: "(416) 555-0131", pickup: PICKUP, delivery: DELIVERY, paperwork: [{ key: "pickup_freight", mode: "off" }] }));
    expect(res.status).toBe(201);
    loadId = ((await res.json()) as { id: string }).id;
    let pw = (await (await pwGET(req("GET", "", "dispatch"), p(loadId))).json()) as { items: { key: string; mode: string; missing: boolean }[]; missing: number; customized: boolean };
    expect(pw.customized).toBe(true);
    expect(pw.items.map((i) => i.key)).not.toContain("pickup_freight");
    expect(pw.missing).toBe(0); // nothing is due before pickup
    await getDb().update(schema.loads).set({ status: "at_pickup" }).where(eq(schema.loads.id, loadId));
    pw = (await (await pwGET(req("GET", "", "dispatch"), p(loadId))).json()) as typeof pw;
    expect(pw.items.filter((i) => i.missing).map((i) => i.key).sort()).toEqual(["pickup_bol", "pickup_seal"]);
    // Changing this load only.
    const put = await pwPUT(req("PUT", "", "dispatch", { items: [{ key: "pickup_seal", mode: "optional" }] }), p(loadId));
    expect(((await put.json()) as typeof pw).missing).toBe(1);
  });

  it("the team uploads a file; only the load's company can open it; the type is checked", async () => {
    const h = { cookie: cookies.dispatch!, origin: BASE };
    expect((await docPOST(upload(`/api/loads/${loadId}/documents`, h, { itemKey: "pickup_bol" }, Buffer.from("not a picture")), p(loadId))).status).toBe(400);
    const r = await docPOST(upload(`/api/loads/${loadId}/documents`, h, { itemKey: "pickup_bol" }, PNG), p(loadId));
    expect(r.status).toBe(201);
    const pw = (await r.json()) as { missing: number; items: { key: string; docs: { id: string; contentType: string; by: string }[] }[] };
    expect(pw.missing).toBe(0);
    const doc = pw.items.find((i) => i.key === "pickup_bol")!.docs[0]!;
    expect(doc).toMatchObject({ contentType: "image/png", by: "team" });
    expect(JSON.stringify(pw)).not.toContain("fileKey");
    const ok = await docGET(req("GET", "", "dispatch"), { params: Promise.resolve({ id: loadId, docId: doc.id }) });
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await docGET(req("GET", "", "other"), { params: Promise.resolve({ id: loadId, docId: doc.id }) })).status).toBe(404);
  });

  it("the driver sends a scan from the app for their own load only", async () => {
    // The driver joins through the app link and accepts (their company's driver loads need no accept; this one is outside).
    const link = (await (await createPOST(req("POST", "/api/loads", "dispatch", { reference: "PW-2", driverPhone: "(416) 555-0132", pickup: PICKUP, delivery: DELIVERY }))).json()) as { id: string; driverLink: string };
    await phone.signIn(link.driverLink);
    expect((await phone.answer(link.id, "accept")).status).toBe(200);
    const auth = { authorization: `Bearer ${phone.token}` };
    const list = (await (await driverPwGET(new Request(`${BASE}/x`, { headers: auth }), p(link.id))).json()) as { items: { key: string; due: boolean }[] };
    expect(list.items.map((i) => i.key)).toContain("delivery_pod");
    const up = await driverPwPOST(upload("/x", auth, { itemKey: "delivery_pod", method: "scan", lat: "45.5", lon: "-73.55", capturedAt: new Date().toISOString() }, PNG), p(link.id));
    expect(up.status).toBe(201);
    const [row] = await getDb().select().from(schema.loadDocuments).where(eq(schema.loadDocuments.loadId, link.id));
    expect(row).toMatchObject({ method: "scan", itemKey: "delivery_pod" });
    expect(row!.driverId).not.toBeNull();
    // Someone else's load: the driver can't touch it.
    expect((await driverPwPOST(upload("/x", auth, { itemKey: "pickup_bol" }, PNG), p(loadId))).status).toBe(404);
  });

  it("the packet is one PDF with every document and goes to the company's list", async () => {
    const pdf = await packetGET(req("GET", "", "dispatch"), p(loadId));
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    outbox.length = 0;
    const r = await packetPOST(req("POST", "", "dispatch", {}), p(loadId));
    expect(r.status).toBe(200);
    const sent = (await r.json()) as { sentTo: string[] };
    expect(sent.sentTo.sort()).toEqual(["billing@northbound.test", "dispatch@pw.test"]);
    expect(outbox).toHaveLength(2);
    expect(outbox[0]!.attachments![0]!.filename).toBe("PW-1-packet.pdf");
    const [l] = await getDb().select({ at: schema.loads.packetSentAt }).from(schema.loads).where(eq(schema.loads.id, loadId));
    expect(l!.at).not.toBeNull();
  });

  it("a removed file disappears; reminders go out for missing required paperwork", async () => {
    const pw = (await (await pwGET(req("GET", "", "dispatch"), p(loadId))).json()) as { items: { key: string; docs: { id: string }[] }[] };
    const doc = pw.items.find((i) => i.key === "pickup_bol")!.docs[0]!;
    expect((await docDELETE(req("DELETE", "", "dispatch"), { params: Promise.resolve({ id: loadId, docId: doc.id }) })).status).toBe(200);
    await getDb().insert(schema.loadEvents).values({ organizationId: (await getDb().select().from(schema.loads).where(eq(schema.loads.id, loadId)))[0]!.organizationId, loadId, type: "arrived_pickup", at: new Date(Date.now() - 20 * 60_000) });
    expect(await runPaperworkReminders()).toBe(1);
    // Not again within the hour.
    expect(await runPaperworkReminders()).toBe(0);
    const ev = await getDb().select().from(schema.loadEvents).where(eq(schema.loadEvents.loadId, loadId));
    expect(ev.some((e) => e.type === "paperwork_reminder")).toBe(true);
  });

  it("manual delivered with send-on-delivery emails the packet", async () => {
    const g = (await (await settingsGET(req("GET", "/api/organization/paperwork", "admin"))).json()) as { settings: { items: unknown[] } };
    await settingsPUT(req("PUT", "/api/organization/paperwork", "admin", { items: g.settings.items, recipients: ["billing@northbound.test"], toCreator: false, sendWhen: "delivered" }));
    const res = await createPOST(req("POST", "/api/loads", "dispatch", { reference: "PW-3", driverPhone: "(416) 555-0133", pickup: PICKUP, delivery: DELIVERY }));
    const id = ((await res.json()) as { id: string }).id;
    outbox.length = 0;
    expect((await statusPOST(req("POST", "", "dispatch", { action: "delivered" }), p(id))).status).toBe(200);
    const sentEvent = async () => (await getDb().select().from(schema.loadEvents).where(eq(schema.loadEvents.loadId, id))).some((e) => e.type === "packet_sent");
    for (let i = 0; i < 60 && !(await sentEvent()); i++) await new Promise((r) => setTimeout(r, 50));
    expect(outbox.map((m) => m.to)).toEqual(["billing@northbound.test"]);
  });
});

describe("driver number lookup", () => {
  it("knows a driver on the app; full name only for drivers this company worked with", async () => {
    // PW-2's driver signed in to the app above (+14165550132) and hauled for this company.
    const mine = (await (await lookupGET(req("GET", `/api/drivers/lookup?phone=${encodeURIComponent("(416) 555-0132")}`, "dispatch"))).json()) as { onRio: boolean; known: boolean; name: string | null };
    expect(mine).toMatchObject({ onRio: true, known: true });
    const other = (await (await lookupGET(req("GET", `/api/drivers/lookup?phone=${encodeURIComponent("(416) 555-0132")}`, "other"))).json()) as { onRio: boolean; known: boolean; name: string | null };
    expect(other.onRio).toBe(true);
    expect(other.known).toBe(false);
    expect(other.name === null || /^\S+( \S\.)?$/.test(other.name)).toBe(true);
    const none = (await (await lookupGET(req("GET", `/api/drivers/lookup?phone=${encodeURIComponent("(905) 555-0199")}`, "dispatch"))).json()) as { onRio: boolean; name: string | null };
    expect(none).toMatchObject({ onRio: false, name: null });
    expect((await lookupGET(req("GET", "/api/drivers/lookup?phone=123", "dispatch"))).status).toBe(400);
  });
});

describe("console: all drivers and plan options", () => {
  it("lists each person once with their companies and app", async () => {
    const all = await listPlatformDrivers();
    const me = all.items.find((d) => d.phone === "+14165550132");
    expect(me).toBeTruthy();
    expect(me!.app).toBe("on");
    expect(all.counts.all).toBeGreaterThan(0);
    const onApp = await listPlatformDrivers({ filter: "app_on", search: "416" });
    expect(onApp.items.every((d) => d.app === "on")).toBe(true);
  });
  it("plans default to Loads in the menu", async () => {
    for (const p of await listPlans()) expect(typeof p.loadsInMenu).toBe("boolean");
  });
});
