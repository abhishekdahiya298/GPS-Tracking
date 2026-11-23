import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Redis calls reverseGeocode makes.
const store = new Map<string, string>();
const fakeRedis = {
  mget: async (...keys: string[]) => keys.map((k) => store.get(k) ?? null),
  set: async (k: string, v: string, ..._rest: unknown[]) => {
    if (_rest.includes("NX") && store.has(k)) return null;
    store.set(k, v);
    return "OK";
  },
  multi() {
    const ops: [string, string][] = [];
    const m = { set: (k: string, v: string) => (ops.push([k, v]), m), exec: async () => ops.forEach(([k, v]) => store.set(k, v)) };
    return m;
  }
};
vi.mock("./redis", () => ({ getReadyRedisPublisher: async () => fakeRedis }));
vi.mock("./maps-settings", () => ({ getMapsSettings: async () => ({ addressProvider: "geoapify" }) }));
vi.mock("./geocode", () => ({ cleanAddress: () => ({ label: "" }), waitForSlot: async () => true }));

const ok = (street: string) => async () => new Response(JSON.stringify({ results: [{ housenumber: "8", street, city: "Brampton", state_code: "ON" }] }), { status: 200 });

describe("reverseGeocode cache and back-off", () => {
  beforeEach(() => store.clear());

  it("looks a spot up once, then answers from the cache", async () => {
    const { reverseGeocode } = await import("./reverse-geocode");
    const f = vi.fn(ok("Main St"));
    expect((await reverseGeocode(43.71001, -79.73702, f)).address?.label).toBe("8 Main St, Brampton, ON");
    expect((await reverseGeocode(43.71003, -79.73704, f)).address?.label).toBe("8 Main St, Brampton, ON");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("uses an address cached within ~110 m (marked approximate) instead of a new lookup", async () => {
    const { reverseGeocode } = await import("./reverse-geocode");
    const f = vi.fn(ok("Main St"));
    await reverseGeocode(43.7101, -79.7371, f);
    const near = await reverseGeocode(43.7104, -79.7374, f);
    expect(near).toMatchObject({ approximate: true, address: { line1: "8 Main St" } });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("when the service throttles, pauses lookups and tells the screen when to retry", async () => {
    const { reverseGeocode } = await import("./reverse-geocode");
    const throttled = vi.fn(async () => new Response("slow down", { status: 429 }));
    expect(await reverseGeocode(40.2075, -76.5779, throttled)).toMatchObject({ address: null, retryAfter: 60 });
    const f = vi.fn(ok("Main St"));
    expect(await reverseGeocode(41.0, -77.0, f)).toMatchObject({ address: null, retryAfter: 60 });
    expect(f).not.toHaveBeenCalled(); // paused: no request while cooling down
  });
});
