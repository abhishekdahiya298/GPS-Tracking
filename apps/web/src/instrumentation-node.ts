/** Node.js-only startup work (imported from instrumentation.ts only in the nodejs runtime). */
import { startAlertScheduler } from "./lib/alerts";
import { getServerEnv } from "./lib/env";
import { logger } from "./lib/logger";

export function startNode() {
  try {
    const env = getServerEnv();
    logger.info("startup.config_valid", { nodeEnv: env.NODE_ENV });
    if (env.ALERTS_SCHEDULER_ENABLED) startAlertScheduler();
  } catch (err) {
    logger.error("startup.config_invalid", {}, err);
    process.exit(1);
  }
}
