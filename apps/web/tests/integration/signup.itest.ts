import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizationPlanAccess } from "@/lib/plans";
import { archiveInactiveFreeCompanies } from "@/lib/signup";
import { POST as startPOST } from "@/app/api/signup/start/route";
import { POST as joinPOST } from "@/app/api/signup/join/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";
import { POST as verifyPOST } from "@/app/api/signup/verify/route";
import { POST as resendPOST } from "@/app/api/signup/resend/route";
import { setEmailTransportForTests, type EmailMessage } from "@/lib/email";

const BASE = "http://localhost:3000";
let ipN = 1;
const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.114.${ipN++}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const company = (over: Record<string, unknown> = {}) => ({
  role: "fleet",
  company: "Dhillon Transport",
  name: "Gurpreet Dhillon",
  phone: "(905) 555-0121",
  email: "gurpreet@dhillon.test",
  password: "a-long-enough-password",
  fleetSize: "2-5",
  country: "CA",
  timeZone: "America/Toronto",
  agree: true,
  ...over
});

beforeAll(async () => {
  await getDb().execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations, leads, phone_codes restart identity cascade`);
  await getDb().delete(schema.platformSettings).where(eq(schema.platformSettings.key, "signup"));
});
afterAll(async () => {
  await closeDb();
});

let cookie = "";
let orgId = "";

describe("public sign-up", () => {
  it("a fleet owner opens a company on Free Basic and is signed in", async () => {
    const res = await startPOST(post("/api/signup/start", company()));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { signedIn: boolean }).signedIn).toBe(true);
    cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookie).toMatch(/session_token/);
    const [org] = await getDb().select().from(schema.organizations).where(eq(schema.organizations.signupPhone, "+19055550121"));
    orgId = org!.id;
    expect(org).toMatchObject({ name: "Dhillon Transport", signupRole: "fleet" });
    expect(org!.joinCode).toMatch(/^DHILLON-\d{4}$/);
    expect((await organizationPlanAccess(orgId))!.planName).toBe("Free Basic");
    const [lead] = await getDb().select().from(schema.leads).where(eq(schema.leads.organizationId, orgId));
    expect(lead).toMatchObject({ source: "signup", planName: "Free Basic" });
  });

  it("the same email or the same phone can't open a second company", async () => {
    const a = await startPOST(post("/api/signup/start", company({ phone: "(905) 555-0199" })));
    expect(a.status).toBe(409);
    const b = await startPOST(post("/api/signup/start", company({ email: "other@dhillon.test" })));
    expect(b.status).toBe(409);
    expect(JSON.stringify(await b.json())).toMatch(/phone number already/);
  });

  it("bad input gets plain messages", async () => {
    const res = await startPOST(post("/api/signup/start", company({ email: "x@y.test", phone: "12", password: "short", agree: false })));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/phone number like|10 characters|agree/);
  });

  it("brokers are closed by default", async () => {
    const res = await startPOST(post("/api/signup/start", company({ role: "broker", email: "b@b.test", phone: "(416) 555-0100" })));
    expect(res.status).toBe(403);
  });

  it("a driver joins with the company code (counts against the plan's drivers)", async () => {
    const [org] = await getDb().select({ code: schema.organizations.joinCode }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
    const res = await joinPOST(post("/api/signup/join", { code: org!.code!.toLowerCase(), name: "Harjit Singh", phone: "416-555-0142" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { companyName: string }).companyName).toBe("Dhillon Transport");
    const drivers = await getDb().select().from(schema.drivers).where(eq(schema.drivers.organizationId, orgId));
    expect(drivers.map((d) => d.phone)).toEqual(["+14165550142"]);
    // Joining again with the same phone doesn't add a duplicate.
    expect((await joinPOST(post("/api/signup/join", { code: org!.code!, name: "Harjit", phone: "4165550142" }))).status).toBe(201);
    // Free Basic allows 2 drivers.
    expect((await joinPOST(post("/api/signup/join", { code: org!.code!, name: "Bo", phone: "4165550143" }))).status).toBe(201);
    expect((await joinPOST(post("/api/signup/join", { code: org!.code!, name: "Cy", phone: "4165550144" }))).status).toBe(403);
    expect((await joinPOST(post("/api/signup/join", { code: "NOPE-0000", name: "Di", phone: "4165550145" }))).status).toBe(400);
  });

  it("archives free companies nobody signs in to", async () => {
    expect(await archiveInactiveFreeCompanies(new Date())).toBe(0); // brand new
    expect(await archiveInactiveFreeCompanies(new Date(Date.now() + 120 * 86_400_000))).toBe(1);
    await getDb().update(schema.organizations).set({ status: "active" }).where(eq(schema.organizations.id, orgId));
  });

  it("the owner can delete their account; the empty company is archived", async () => {
    expect((await deletePOST(post("/api/account/delete", { password: "wrong-password", confirm: "DELETE" }, cookie))).status).toBe(400);
    const res = await deletePOST(post("/api/account/delete", { password: "a-long-enough-password", confirm: "DELETE" }, cookie));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archived: string[] }).archived).toEqual(["Dhillon Transport"]);
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "gurpreet@dhillon.test"));
    expect(u).toBeUndefined();
  });

  it("with email on, one code goes to the email and is typed once", async () => {
    const sent: EmailMessage[] = [];
    setEmailTransportForTests(async (m) => {
      sent.push(m);
    });
    try {
      const body = company({ email: "owner@coded.test", phone: "(647) 555-0170", company: "Coded Freight" });
      const res = await startPOST(post("/api/signup/start", body));
      expect(res.status).toBe(202);
      const r = (await res.json()) as { status: string; token: string; sentTo: { email: string | null; phone: string | null } };
      expect(r.status).toBe("code_sent");
      expect(r.sentTo.email).toMatch(/^o•+@coded\.test$/);
      expect(r.sentTo.phone).toBeNull(); // no texts on this server
      const mail = sent.find((m) => m.template === "signup_code" && m.to === "owner@coded.test");
      const code = /\b(\d{6})\b/.exec(mail!.subject)![1]!;
      // Nothing exists until the code is right.
      const [none] = await getDb().select().from(schema.users).where(eq(schema.users.email, "owner@coded.test"));
      expect(none).toBeUndefined();
      const wrong = code === "000000" ? "111111" : "000000";
      expect((await verifyPOST(post("/api/signup/verify", { token: r.token, code: wrong, password: "a-long-enough-password" }))).status).toBe(400);
      // Send again: a fresh code replaces the old one.
      await getDb().update(schema.phoneCodes).set({ createdAt: new Date(Date.now() - 60_000) });
      const again = await resendPOST(post("/api/signup/resend", { token: r.token }));
      expect(again.status).toBe(200);
      const mail2 = sent.filter((m) => m.template === "signup_code").at(-1)!;
      const code2 = /\b(\d{6})\b/.exec(mail2.subject)![1]!;
      const ok = await verifyPOST(post("/api/signup/verify", { token: r.token, code: code2, password: "a-long-enough-password" }));
      expect(ok.status).toBeLessThan(300);
      const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "owner@coded.test"));
      expect(u).toBeDefined();
    } finally {
      setEmailTransportForTests(null);
    }
  });
});
