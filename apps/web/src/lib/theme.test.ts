import { describe, expect, it } from "vitest";
import { readTheme } from "./theme";

describe("readTheme", () => {
  it("keeps each choice, and starts light on a first visit", () => {
    expect(readTheme("light")).toBe("light");
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("system")).toBe("system");
    expect(readTheme("blue")).toBe("light");
    expect(readTheme(undefined)).toBe("light");
  });
});
