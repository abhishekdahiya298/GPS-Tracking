import { describe, expect, it } from "vitest";
import { isValidImei, parseImeiList } from "./imei-list";

describe("parseImeiList", () => {
  it("reads IMEIs with optional names, skipping a header and blank lines", () => {
    const out = parseImeiList("IMEI,Name\n864361078566024, Truck 12\n\n864361078566115\t Trailer 3 \n");
    expect(out.problems).toEqual([]);
    expect(out.rows).toEqual([
      { line: 2, imei: "864361078566024", name: "Truck 12" },
      { line: 4, imei: "864361078566115", name: "Trailer 3" }
    ]);
  });

  it("accepts spaced or dashed numbers", () => {
    expect(parseImeiList("8643 6107 8566 024\n86436-1078566115").rows.map((r) => r.imei)).toEqual(["864361078566024", "864361078566115"]);
  });

  it("reports short numbers, typos and repeats with their line", () => {
    const out = parseImeiList("86436107856602\n864361078566025\n864361078566024\n864361078566024");
    expect(out.rows.map((r) => r.imei)).toEqual(["864361078566024"]);
    expect(out.problems.map((p) => [p.line, p.reason])).toEqual([
      [1, "not_15_digits"],
      [2, "check_digit"],
      [4, "duplicate"]
    ]);
  });

  it("implements the Luhn check", () => {
    expect(isValidImei("864361078566024")).toBe(true);
    expect(isValidImei("864361078566025")).toBe(false);
  });
});
