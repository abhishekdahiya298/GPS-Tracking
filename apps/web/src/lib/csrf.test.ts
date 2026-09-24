import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./csrf";
import { ForbiddenError } from "./errors";

const O = "https://gps.example.com";
const req = (method: string, h: Record<string, string> = {}) => new Request(`${O}/api/x`, { method, headers: h });

describe("assertSameOrigin", () => {
  it("allows safe methods without headers", () => {
    expect(() => assertSameOrigin(req("GET"), O)).not.toThrow();
  });
  it("allows a matching Origin", () => {
    expect(() => assertSameOrigin(req("POST", { origin: O }), O)).not.toThrow();
  });
  it("rejects a foreign Origin even with a matching Referer", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.test", referer: `${O}/x` }), O)).toThrow(ForbiddenError);
  });
  it("falls back to Referer when Origin is absent", () => {
    expect(() => assertSameOrigin(req("DELETE", { referer: `${O}/dashboard` }), O)).not.toThrow();
    expect(() => assertSameOrigin(req("DELETE", { referer: "https://gps.example.com.evil.test/" }), O)).toThrow(ForbiddenError);
  });
  it("rejects when both Origin and Referer are missing", () => {
    expect(() => assertSameOrigin(req("PATCH"), O)).toThrow(ForbiddenError);
  });
});
