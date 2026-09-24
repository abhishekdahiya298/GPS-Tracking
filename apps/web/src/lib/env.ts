import { z } from "zod";

/**
 * Server-side configuration, validated once at startup (see src/instrumentation.ts)
 * so a misconfigured deployment fails immediately instead of half-working.
 * Only settings that genuinely differ between environments live here; everything
 * else is a code-level default.
 */
const secret = (name: string) =>
  z.string({ required_error: `${name} is required` }).min(32, `${name} must be at least 32 characters`);

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RIO_DATABASE_URL: z.string().url("RIO_DATABASE_URL must be a postgres:// URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a redis:// URL"),
  TRACCAR_WEBHOOK_SECRET: secret("TRACCAR_WEBHOOK_SECRET"),
  AUTH_SECRET: secret("AUTH_SECRET"),
  AUTH_URL: z.string().url("AUTH_URL must be the public base URL, e.g. https://gps.example.com"),
  /** A device is "online" if RIO received data from it within this many seconds. */
  GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_900),
  /** Upper bound on a single location-history query window. */
  MAX_HISTORY_RANGE_DAYS: z.coerce.number().int().min(1).max(366).default(31),
  /** Interval between SSE keep-alive comments. */
  SSE_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(120).default(15)
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export class ConfigurationError extends Error {}

/** Parses process.env once; throws ConfigurationError listing every problem (never the values). */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && source === process.env) {
    return cached;
  }
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigurationError(`Invalid server configuration:\n  - ${problems.join("\n  - ")}`);
  }
  if (source === process.env) {
    cached = result.data;
  }
  return result.data;
}
