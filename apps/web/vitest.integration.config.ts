import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: real Better Auth + real PostgreSQL + real Redis.
 * Requires TEST_DATABASE_URL (a disposable database — it is migrated and
 * truncated) and TEST_REDIS_URL. Never point these at production.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.itest.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000
  }
});
