import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Lazily-created singleton connection to RIO's own database. Never point this
 * at Traccar's database — Traccar is accessed only through its REST API or
 * its outgoing webhook, never via direct SQL from RIO.
 */
export function getDb() {
  if (!db) {
    const connectionString = process.env.RIO_DATABASE_URL;
    if (!connectionString) {
      throw new Error("RIO_DATABASE_URL is not set");
    }
    client = postgres(connectionString);
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  await client?.end();
  client = null;
  db = null;
}

export * as schema from "./schema/index.js";
