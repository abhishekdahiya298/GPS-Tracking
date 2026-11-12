import { describe, expect, it } from "vitest";
import { addressKey, createAddressCache } from "./model";

describe("addressKey", () => {
  it("is the same for positions a few metres apart", () => {
    expect(addressKey(43.65321, -79.38321)).toBe(addressKey(43.65339, -79.38349));
    expect(addressKey(43.653, -79.383)).not.toBe(addressKey(43.663, -79.383));
  });
});

describe("createAddressCache", () => {
  it("remembers addresses and the lack of one", () => {
    const cache = createAddressCache();
    cache.set("a", "1 Main St");
    cache.set("b", null);
    expect(cache.get("a")).toBe("1 Main St");
    expect(cache.has("b")).toBe(true);
    expect(cache.get("b")).toBeNull();
    expect(cache.has("c")).toBe(false);
  });
  it("drops the oldest past the limit", () => {
    const cache = createAddressCache(2);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    expect(cache.has("a")).toBe(false);
    expect(cache.size()).toBe(2);
  });
});
