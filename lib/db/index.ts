import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as relations from "../../drizzle/relations";
import * as schema from "../../drizzle/schema";

/**
 * WebSocket-pooled Neon driver.
 *
 * We use `drizzle-orm/neon-serverless` (a pooled WebSocket connection) rather
 * than `neon-http`. The HTTP driver opens a fresh TLS roundtrip per statement
 * and — critically — throws "No transactions support in neon-http driver", so
 * hot, multi-statement paths (the dashboard read, the webhook upsert) paid a
 * roundtrip per query and could not run inside a transaction (issues #64, #66).
 * The Pool keeps a warm WebSocket that multiplexes statements and supports
 * real interactive transactions.
 *
 * `webSocketConstructor` is left unset: the driver falls back to the native
 * global `WebSocket`, which is present on Node 22+ / the Vercel runtime, so no
 * `ws` dependency is required.
 */
let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

/**
 * The pooled WebSocket connection itself.
 *
 * Exported next to the Drizzle instance because some work needs a dedicated
 * connection rather than a statement on the shared pool — the Strava sync
 * holds a session-scoped advisory lock on one connection for the length of
 * the sync (issue #338). A transaction cannot do that: it would have to stay
 * open across the whole network paging.
 */
export function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL (or DATABASE_URL) is not set");
    }
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool(), {
      schema: { ...schema, ...relations },
      casing: "snake_case",
    });
  }
  return _db;
}

/**
 * Convenience singleton — lazy, won't connect until first use.
 *
 * A Proxy forwards every property access to the real Drizzle instance, so
 * callers get the fully typed db object while the connection itself stays
 * lazy. The target is an empty object: it is never read, only its property
 * lookups are intercepted.
 */
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export type Database = typeof db;

/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
