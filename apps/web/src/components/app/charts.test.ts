import { describe, expect, it } from "vitest";
import { niceScale } from "./charts";

describe("niceScale", () => {
  it("rounds the axis top up to clean ticks", () => {
    expect(niceScale(182.4)).toEqual({ top: 200, ticks: [0, 50, 100, 150, 200] });
    expect(niceScale(3473)).toEqual({ top: 4000, ticks: [0, 1000, 2000, 3000, 4000] });
    expect(niceScale(7)).toEqual({ top: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(0.9).top).toBe(1);
    expect(niceScale(100).top).toBe(100);
  });
  it("never divides by zero on empty data", () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceScale(NaN).top).toBe(1);
  });
});
