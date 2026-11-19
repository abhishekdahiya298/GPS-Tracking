import { describe, expect, it } from "vitest";
import { pageList } from "./pagination";

describe("pageList", () => {
  it("shows every page when there are few", () => expect(pageList(2, 5)).toEqual([1, 2, 3, 4, 5]));
  it("keeps the ends and the current page's neighbours", () => {
    expect(pageList(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageList(20, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
  });
});
