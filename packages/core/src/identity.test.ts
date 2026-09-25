import { describe, expect, it } from "vitest";
import { isValidImei } from "./identity.js";

describe("isValidImei", () => {
  it("accepts the real FTM880 IMEI and rejects typos", () => {
    expect(isValidImei("864361078566115")).toBe(true);
    expect(isValidImei("864361078566116")).toBe(false); // last digit typo
    expect(isValidImei("864361078565115")).toBe(false); // middle digit typo
    expect(isValidImei("86436107856611")).toBe(false);
    expect(isValidImei("86436107856611a")).toBe(false);
  });
});
