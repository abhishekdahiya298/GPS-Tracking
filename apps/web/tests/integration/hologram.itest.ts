import "./setup-env";
// Hologram switched on for this file (before any app module reads the settings).
process.env.HOLOGRAM_API_KEY = "k".repeat(32);
process.env.HOLOGRAM_ORG_ID = "12345";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imeiForSim, imeiInName, mapHologramState, nameKey, setHologramFetchForTests, syncHologramSims } from "@/lib/hologram";
import { listSims, setSimCost, SimListQuery } from "@/lib/sims";

const calls: string[] = [];
let orgA = "";
let trackerA = "";
let trackerNamed = "";

const device = (id: number, name: string, imei: string | null, sim: string, state: string) => ({
  id,
  name,
  imei,
  intended_plan_name: "Global G3 Standard Flat Rate",
  links: { cellular: [{ sim, msisdn: null, state, apn: "hologram" }] }
});

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`truncate audit_logs, organizations, sim_cards, gps_devices restart identity cascade`);
  const [a] = await db.insert(schema.organizations).values({ name: "RIO California Inc", slug: "rio" }).returning();
  orgA = a!.id;
  const [p] = await db.insert(schema.gpsProviders).values({ organizationId: orgA, name: "Traccar", apiBaseUrl: "http://traccar:8082" }).returning();
  const [d1] = await db.insert(schema.gpsDevices).values({ organizationId: orgA, providerId: p!.id, externalDeviceId: "864361078566115", imei: "864361078566115", model: "FTM880" }).returning();
  trackerA = d1!.id;
  await db.insert(schema.gpsDevices).values({ organizationId: null, providerId: null, externalDeviceId: "868038076566307", imei: "868038076566307", model: "FTM164" });
  const [d3] = await db.insert(schema.gpsDevices).values({ organizationId: null, providerId: null, externalDeviceId: "868038076566554", imei: "868038076566554", name: "Truck-12" }).returning();
  trackerNamed = d3!.id;
  // Two pages from Hologram.
  setHologramFetchForTests((async (url: string, init?: RequestInit) => {
    calls.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`);
    const u = new URL(url);
    const first = !u.searchParams.get("startafter");
    return new Response(
      JSON.stringify(
        first
          ? { success: true, continues: true, lastid: 2, data: [device(1, "GPS-864361078566115", "864361078566115", "89464278206211323134", "LIVE"), device(2, "GPS-868038076566307", null, "89464278206255253437", "LIVE")] }
          : { success: true, continues: false, data: [device(3, "GPS-999999999999999", null, "89464278206255253825", "PAUSED-USER"), device(4, "truck 12", null, "89464278206255253999", "INACTIVE")] }
      ),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch);
});

afterAll(async () => {
  setHologramFetchForTests(null);
  await closeDb();
});

describe("Hologram SIM sync", () => {
  it("maps states and finds the tracker IMEI", () => {
    expect(["LIVE", "PAUSED-SYS", "DEAD-PENDING", "INACTIVE", "TEST-ACTIVATE"].map(mapHologramState)).toEqual(["active", "suspended", "cancelled", "inventory", "inventory"]);
    expect(imeiForSim({ imei: null, name: "GPS-868038076566307" })).toBe("868038076566307");
    expect(imeiForSim({ imei: "Not available", name: "Truck 7" })).toBeNull();
    // Names typed by hand: spaces, dashes, extra words.
    expect(imeiInName("8680 3807 6566 455")).toBe("868038076566455");
    expect(imeiInName("gps 868-038-076-566-455")).toBe("868038076566455");
    expect(imeiInName("Truck 12 / 868038076566455")).toBe("868038076566455");
    expect(imeiInName("Truck 12")).toBeNull();
    expect(imeiInName("89464278206211323134")).toBeNull(); // an ICCID is not an IMEI
    expect(nameKey(" Truck-12 ")).toBe("truck12");
  });

  it("copies every SIM, links each to its tracker by IMEI or name, and reads all pages with the key", async () => {
    const r = await syncHologramSims(null);
    expect(r).toMatchObject({ seen: 4, added: 4, linked: 3, unmatched: ["999999999999999"] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("orgid=12345");
    expect(calls[0]).toContain(`Basic ${Buffer.from(`apikey:${"k".repeat(32)}`).toString("base64")}`);
    expect(calls[1]).toContain("startafter=2");
    const sims = await getDb().select().from(schema.simCards);
    const byIccid = Object.fromEntries(sims.map((s) => [s.iccid, s]));
    expect(byIccid["89464278206211323134"]).toMatchObject({ deviceId: trackerA, status: "active", carrier: "Hologram", plan: "Global G3 Standard Flat Rate", provider: "hologram", providerRef: "1" });
    expect(byIccid["89464278206255253825"]).toMatchObject({ deviceId: null, status: "suspended" });
    // No IMEI in the name: matched by the tracker's name in RIO; the typed name is kept.
    expect(byIccid["89464278206255253999"]).toMatchObject({ deviceId: trackerNamed, providerName: "truck 12" });
  });

  it("a second run changes nothing; cost set once applies to every Hologram SIM; the stock tracker's live SIM is flagged", async () => {
    const r = await syncHologramSims(null);
    expect(r).toMatchObject({ added: 0, updated: 0, linked: 0 });
    expect((await setSimCost(null, { monthlyCost: 300, scope: "hologram" }, { ipAddress: null, userAgent: null })).updated).toBe(4);
    const list = await listSims(SimListQuery.parse({ view: "attention" }));
    // Active SIM in a tracker that is still in RIO stock: paid for, not serving a customer.
    expect(list.items.map((s) => s.iccid)).toEqual(["89464278206255253437"]);
    expect(list.counts.wasted).toBe(300);
    expect((await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "sim.synced"))).length).toBe(1);
  });
});
