/**
 * Minimal structured (JSON-lines) logger. Deliberately dependency-free; every
 * line is one JSON object on stdout/stderr so Docker's log driver and any
 * future shipper can parse it. Never pass secrets, cookies, tokens or full
 * GPS payloads in `fields` — log identifiers and metadata only.
 */
type Level = "debug" | "info" | "warn" | "error";

const SERVICE = "rio-gps-web";

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
    };
  }
  return { message: String(err) };
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}, err?: unknown) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    event,
    ...fields,
    ...(err ? { error: serializeError(err) } : {})
  });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>, err?: unknown) => write("warn", event, fields, err),
  error: (event: string, fields?: Record<string, unknown>, err?: unknown) => write("error", event, fields, err)
};
