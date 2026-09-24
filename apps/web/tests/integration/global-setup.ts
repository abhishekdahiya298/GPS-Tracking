import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  const redis = process.env.TEST_REDIS_URL;
  if (!url || !redis) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required for integration tests");
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("Refusing to run: TEST_DATABASE_URL database name must contain 'test'");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url))
  });
  await sql.end();
}
