import { describe, expect, it } from "vitest";
import { checkPhone, displayPhone, formatNational, toE164 } from "./phone";

describe("checkPhone (Canada and US)", () => {
  it("accepts the common ways of typing a number", () => {
    for (const v of ["416 555 0142", "(416) 555-0142", "416.555.0142", "4165550142", "+1 416 555 0142", "1-416-555-0142", "+14165550142"]) {
      expect(checkPhone(v)).toEqual({ ok: true, e164: "+14165550142", national: "(416) 555-0142", country: "CA" });
    }
  });
  it("knows the country from the area code", () => {
    expect(checkPhone("212 555 0142")).toMatchObject({ ok: true, country: "US" });
    expect(checkPhone("604 555 0142")).toMatchObject({ ok: true, country: "CA" });
    expect(checkPhone("716 555 0190")).toMatchObject({ ok: true, country: "US" });
  });
  it("explains what is wrong", () => {
    expect(checkPhone("")).toMatchObject({ ok: false, incomplete: true });
    expect(checkPhone("416 555 01")).toMatchObject({ ok: false, error: "Enter all 10 digits.", incomplete: true });
    expect(checkPhone("116 555 0142")).toMatchObject({ ok: false });
    expect(checkPhone("416 055 0142")).toMatchObject({ ok: false });
    expect(checkPhone("800 555 0142")).toMatchObject({ ok: false });
    expect(checkPhone("411 555 0142")).toMatchObject({ ok: false });
    expect(checkPhone("876 555 0142")).toMatchObject({ ok: false });
    expect(checkPhone("+44 20 7946 0958")).toMatchObject({ ok: false });
    expect(checkPhone("416 555 01422")).toMatchObject({ ok: false });
    expect(checkPhone("phone")).toMatchObject({ ok: false });
  });
  it("formats as you type and for display", () => {
    expect(formatNational("4")).toBe("(4");
    expect(formatNational("41655")).toBe("(416) 55");
    expect(formatNational("4165550142")).toBe("(416) 555-0142");
    expect(displayPhone("+14165550142")).toBe("(416) 555-0142");
    expect(toE164("(212) 555-0142")).toBe("+12125550142");
    expect(toE164("12345")).toBeNull();
  });
});
