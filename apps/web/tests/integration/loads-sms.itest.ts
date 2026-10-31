import "./setup-env";
// Text messages switched on for this file (before any app module reads the settings).
process.env.TWILIO_ACCOUNT_SID = `AC${"1".repeat(32)}`;
process.env.TWILIO_AUTH_TOKEN = "t".repeat(32);
process.env.TWILIO_FROM = "+18885550100";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { POST as createPOST } from "@/app/api/loads/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let cookie = "";
const sent: { to: string; body: string }[] = [];
const realFetch = globalThis.fetch;

const stop = (lat: number) => ({ name: null, address: "Somewhere, ON, Canada", latitude: lat, longitude: -79.4, radiusM: 500, appointmentAt: null });
const create = async (body: Record<string, unknown>) => {
  const res = await createPOST(new Request(`${BASE}/api/loads`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ driverPhone: "4165550199", pickup: stop(43.6), delivery: stop(45.5), ...body }) }));
  return { status: res.status, json: (await res.json()) as { id: string; sms: { sent: boolean } | null; share: { message: string }; error?: { message: string } } };
};

beforeAll(async () => {
  // Twilio is faked: record what would be sent, answer like Twilio does.
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith("https://api.twilio.com/")) {
      const form = new URLSearchParams(String(init?.body));
      sent.push({ to: form.get("To")!, body: form.get("Body")! });
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    }
    return realFetch(url, init);
  });
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  await db.insert(schema.organizations).values({ name: "Texting Broker", slug: "tb" });
  await createUserWithMembership({ email: "d@tb.test", name: "d", password: PASSWORD, organizationSlug: "tb", role: "DISPATCHER" });
  const res = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "198.18.6.1" }, body: JSON.stringify({ email: "d@tb.test", password: PASSWORD }) }));
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("automatic text invites", () => {
  it("are refused without the driver's consent, and nothing is created or sent", async () => {
    const r = await create({ reference: "S-1" });
    expect(r.status).toBe(400);
    expect(r.json.error?.message).toMatch(/driver agreed/);
    expect(sent).toHaveLength(0);
    expect(await getDb().select().from(schema.loads).where(eq(schema.loads.reference, "S-1"))).toHaveLength(0);
  });

  it("are sent with consent, with the STOP line, and the consent is recorded", async () => {
    const r = await create({ reference: "S-2", driverConsent: true });
    expect(r.status).toBe(201);
    expect(r.json.sms).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("+14165550199");
    expect(sent[0]!.body).toContain("Reply STOP");
    // The message for WhatsApp / own phone has no STOP line.
    expect(r.json.share.message).not.toContain("STOP");
    const events = await getDb().select().from(schema.loadEvents).where(eq(schema.loadEvents.loadId, r.json.id));
    expect(events.find((e) => e.type === "created")?.detail).toEqual({ driverTextConsent: true });
    expect(events.some((e) => e.type === "invite_sent")).toBe(true);
  });

  it("need no consent when the broker sends the link themselves", async () => {
    const r = await create({ reference: "S-3", sendInvite: false });
    expect(r.status).toBe(201);
    expect(r.json.sms).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
