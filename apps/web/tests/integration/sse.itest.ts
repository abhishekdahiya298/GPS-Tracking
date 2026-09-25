import "./setup-env";
import { locationChannel } from "@rio-gps/core";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithMembership } from "@/lib/admin-users";
import { getAuth } from "@/lib/auth";
import { getLiveHub } from "@/lib/live-hub";
import { GET as streamGET } from "@/app/api/locations/stream/route";

const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
let orgA: string, orgB: string, devA: string, devB: string;
let publisher: Redis;

async function signIn(email: string, ip: string) {
  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: PASSWORD })
    })
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** Opens a stream and collects parsed SSE events until the stream ends or `ms` elapses. */
function open(cookie: string) {
  const ac = new AbortController();
  const events: { event: string; data: unknown }[] = [];
  let ended = false;
  const ready = streamGET(new Request(`${BASE}/api/locations/stream`, { headers: { cookie }, signal: ac.signal })).then(async (res) => {
    if (res.status !== 200) return res;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      for (;;) {
        const r = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (r.done) {
          ended = true;
          return;
        }
        buf += dec.decode(r.value);
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    })();
    return res;
  });
  return { ready, events, abort: () => ac.abort(), isEnded: () => ended };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 5000) {
  const t = Date.now() + ms;
  while (!pred() && Date.now() < t) await sleep(50);
  return pred();
}

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, rate_limits, sessions, accounts, memberships, users, organizations restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [b] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  orgA = a!.id;
  orgB = b!.id;
  const [pa] = await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "T", apiBaseUrl: "http://t" }).returning();
  const [pb] = await db.insert(schema.gpsProviders).values({ organizationId: orgB, name: "T", apiBaseUrl: "http://t" }).returning();
  devA = (await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: pa!.id, externalDeviceId: "111111111111111", imei: "111111111111111" }).returning())[0]!.id;
  devB = (await db.insert(schema.gpsDevices).values({ organizationId: orgB, providerId: pb!.id, externalDeviceId: "222222222222222", imei: "222222222222222" }).returning())[0]!.id;
  await createUserWithMembership({ email: "a@a.test", name: "a", password: PASSWORD, organizationSlug: "org-a", role: "VIEWER" });
  await createUserWithMembership({ email: "a2@a.test", name: "a2", password: PASSWORD, organizationSlug: "org-a", role: "DISPATCHER" });
  publisher = new Redis(process.env.TEST_REDIS_URL!);
});

afterAll(async () => {
  publisher?.disconnect();
  await closeDb();
});

describe("SSE", () => {
  it("starts with a snapshot of only the caller's org, then live events", async () => {
    const s = open(await signIn("a@a.test", "192.0.2.201"));
    expect((await s.ready).status).toBe(200);
    expect(await until(() => s.events.some((e) => e.event === "snapshot"))).toBe(true);
    const snap = s.events.find((e) => e.event === "snapshot")!.data as { devices: { deviceId: string }[] };
    expect(snap.devices.map((d) => d.deviceId)).toEqual([devA]);
    expect(JSON.stringify(snap)).not.toContain(devB);

    await publisher.publish(locationChannel(orgB), JSON.stringify({ deviceId: devB }));
    await publisher.publish(locationChannel(orgA), JSON.stringify({ deviceId: devA }));
    expect(await until(() => s.events.some((e) => e.event === "location"))).toBe(true);
    await sleep(150);
    const locs = s.events.filter((e) => e.event === "location").map((e) => (e.data as { deviceId: string }).deviceId);
    expect(locs).toEqual([devA]);
    s.abort();
  });

  it("shares one Redis subscription per org and releases it when clients leave", async () => {
    const cookie = await signIn("a@a.test", "192.0.2.202");
    const s1 = open(cookie);
    const s2 = open(cookie);
    await s1.ready;
    await s2.ready;
    await until(() => s1.events.length > 0 && s2.events.length > 0);
    expect(getLiveHub().stats().channels).toBe(2); // locations + alerts
    s1.abort();
    s2.abort();
    expect(await until(() => getLiveHub().stats().listeners === 0)).toBe(true);
    expect(getLiveHub().stats().channels).toBe(0);
  });

  it("limits concurrent streams per user (429)", async () => {
    const cookie = await signIn("a2@a.test", "192.0.2.203");
    const streams = [open(cookie), open(cookie), open(cookie)];
    for (const s of streams) expect((await s.ready).status).toBe(200);
    const extra = open(cookie);
    expect((await extra.ready).status).toBe(429);
    streams.forEach((s) => s.abort());
    await sleep(100);
    const again = open(cookie);
    expect((await again.ready).status).toBe(200);
    again.abort();
  });

  it("closes the stream with end:session_ended after sign-out", async () => {
    const cookie = await signIn("a@a.test", "192.0.2.204");
    const s = open(cookie);
    await s.ready;
    await until(() => s.events.length > 0);
    const out = await getAuth().handler(
      new Request(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json" }, body: "{}" })
    );
    expect(out.status).toBe(200);
    expect(await until(() => s.isEnded(), 6000)).toBe(true);
    expect(s.events.at(-1)).toEqual({ event: "end", data: { reason: "session_ended" } });
  });

  it("closes the stream when the user's membership is removed", async () => {
    const cookie = await signIn("a2@a.test", "192.0.2.205");
    const s = open(cookie);
    await s.ready;
    await until(() => s.events.length > 0);
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "a2@a.test"));
    await getDb().delete(schema.memberships).where(eq(schema.memberships.userId, u!.id));
    expect(await until(() => s.isEnded(), 6000)).toBe(true);
    expect((s.events.at(-1)!.data as { reason: string }).reason).toBe("session_ended");
  });
});
