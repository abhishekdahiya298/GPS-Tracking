/**
 * Next.js startup hook: validate configuration before serving any request.
 * A production server with missing/weak secrets must not start half-configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { getServerEnv } = await import("./lib/env");
  const { logger } = await import("./lib/logger");
  try {
    const env = getServerEnv();
    logger.info("startup.config_valid", { nodeEnv: env.NODE_ENV });
  } catch (err) {
    logger.error("startup.config_invalid", {}, err);
    process.exit(1);
  }
}
