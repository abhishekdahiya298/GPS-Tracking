import { describe, expect, it } from "vitest";
import { readTheme } from "./theme";

describe("readTheme", () => {
  it("keeps light and dark, and treats anything else as the browser's choice", () => {
    expect(readTheme("light")).toBe("light");
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("blue")).toBe("system");
    expect(readTheme(undefined)).toBe("system");
  });
});
