import { beforeEach, describe, expect, it } from "vitest";
import { resetSeenThrottle, SEEN_PUBLISH_MIN_INTERVAL_MS, shouldPublishSeen } from "./seen-throttle";

describe("seen ping throttle", () => {
  beforeEach(() => resetSeenThrottle());

  it("lets the first ping through, then at most one per interval per device", () => {
    const t = 1_000_000;
    expect(shouldPublishSeen("dev-a", t)).toBe(true);
    expect(shouldPublishSeen("dev-a", t + 1_000)).toBe(false);
    expect(shouldPublishSeen("dev-a", t + SEEN_PUBLISH_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPublishSeen("dev-a", t + SEEN_PUBLISH_MIN_INTERVAL_MS)).toBe(true);
  });

  it("throttles each device on its own", () => {
    expect(shouldPublishSeen("dev-a", 0)).toBe(true);
    expect(shouldPublishSeen("dev-b", 10)).toBe(true);
    expect(shouldPublishSeen("dev-a", 20)).toBe(false);
  });
});
