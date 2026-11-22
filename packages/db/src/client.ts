import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

type Client = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

// In development Next.js re-evaluates modules on every hot reload. A module-level singleton
// would then open a fresh pool each time and exhaust Postgres connections ("remaining
// connection slots are reserved"). Keep the pool on globalThis so reloads reuse it.
const g = globalThis as unknown as { __rioDb?: { client: Client; db: Db } };
let client: Client | null = g.__rioDb?.client ?? null;
let db: Db | null = g.__rioDb?.db ?? null;

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
    client = postgres(connectionString, { max: Number(process.env.RIO_DB_POOL_MAX ?? 10) });
    db = drizzle(client, { schema });
    if (process.env.NODE_ENV !== "production") g.__rioDb = { client, db };
  }
  return db;
}

export async function closeDb() {
  await client?.end();
  client = null;
  db = null;
  delete g.__rioDb;
}

export * as schema from "./schema/index.js";
