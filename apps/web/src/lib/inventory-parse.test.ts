import { describe, expect, it } from "vitest";
import { normalizeMsisdn, parseInventoryLines } from "./inventory-parse";

describe("pasted inventory lists", () => {
  it("recognizes IMEI, ICCID and phone in any order and with any separator", () => {
    const rows = parseInventoryLines(["864361078566115, 8901260123456789012, +1 (805) 666-5977", "8901260123456789020\t864361078566123", "864361078566131;8056665978", "# comment", ""].join("\n"));
    expect(rows.map((r) => [r.imei, r.iccid, r.msisdn, r.problem])).toEqual([
      ["864361078566115", "8901260123456789012", "+18056665977", null],
      ["864361078566123", "8901260123456789020", null, null],
      ["864361078566131", null, "8056665978", null]
    ]);
  });

  it("space-separated long numbers and SIM-only lines work; junk is reported", () => {
    const rows = parseInventoryLines("864361078566115 8901260123456789012\n8901260123456789038\nhello");
    expect(rows[0]).toMatchObject({ imei: "864361078566115", iccid: "8901260123456789012", problem: null });
    expect(rows[1]).toMatchObject({ imei: null, iccid: "8901260123456789038", problem: null });
    expect(rows[2]!.problem).toMatch(/No IMEI/);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("phone numbers", () => {
    expect(normalizeMsisdn("+44 7700 900123")).toBe("+447700900123");
    expect(normalizeMsisdn("123")).toBeNull();
  });
});
