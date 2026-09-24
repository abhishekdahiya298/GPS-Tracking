import { describe, expect, it } from "vitest";
import { ConfigurationError, getServerEnv } from "./env.js";

const valid = {
  NODE_ENV: "production",
  RIO_DATABASE_URL: "postgres://rio:pw@postgres:5432/rio",
  REDIS_URL: "redis://redis:6379",
  TRACCAR_WEBHOOK_SECRET: "a".repeat(40),
  AUTH_SECRET: "b".repeat(40),
  AUTH_URL: "https://gps.example.com"
} as NodeJS.ProcessEnv;

describe("getServerEnv", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = getServerEnv({ ...valid });
    expect(env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS).toBe(3900);
    expect(env.MAX_HISTORY_RANGE_DAYS).toBe(31);
  });

  it("fails fast listing every missing or weak setting without echoing values", () => {
    const bad = { ...valid, TRACCAR_WEBHOOK_SECRET: "short-secret-value", REDIS_URL: undefined };
    let message = "";
    try {
      getServerEnv(bad);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      message = (err as Error).message;
    }
    expect(message).toContain("TRACCAR_WEBHOOK_SECRET");
    expect(message).toContain("REDIS_URL");
    expect(message).not.toContain("short-secret-value");
  });
});
