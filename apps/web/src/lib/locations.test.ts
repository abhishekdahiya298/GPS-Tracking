import { describe, expect, it } from "vitest";
import { connectivityStatus, decodeCursor, encodeCursor } from "./locations";

describe("connectivityStatus", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  it("never_seen without a timestamp", () => expect(connectivityStatus(null, now, 3900)).toBe("never_seen"));
  it("online at exactly the threshold", () =>
    expect(connectivityStatus(new Date(now.getTime() - 3900_000), now, 3900)).toBe("online"));
  it("offline past the threshold", () =>
    expect(connectivityStatus(new Date(now.getTime() - 3901_000), now, 3900)).toBe("offline"));
});

describe("history cursor", () => {
  it("round-trips", () => {
    const c = { t: "2026-09-24T12:00:00.000Z", id: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it.each(["", "not-base64!", Buffer.from('{"t":"x","id":1}').toString("base64url"), Buffer.from('{"t":"2026-01-01T00:00:00Z","id":"1"}').toString("base64url")])(
    "rejects malformed cursor %s",
    (raw) => expect(decodeCursor(raw)).toBeNull()
  );
});
