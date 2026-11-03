import { describe, expect, it } from "vitest";
import { compareVersions, updateStatus } from "./app-version.js";

describe("app versions", () => {
  it("compares numerically, part by part", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("0.9.12", "1.0.0")).toBe(-1);
    expect(compareVersions("garbage", "0.0.1")).toBe(-1);
  });
  it("required below the minimum, optional below the latest, otherwise current", () => {
    const p = { minVersion: "1.2.0", latestVersion: "1.4.0" };
    expect(updateStatus("1.1.9", p)).toBe("required");
    expect(updateStatus("1.2.0", p)).toBe("optional");
    expect(updateStatus("1.4.0", p)).toBe("current");
    expect(updateStatus("2.0.0", p)).toBe("current");
    expect(updateStatus("0.1.0", { minVersion: null, latestVersion: null })).toBe("current");
  });
});
