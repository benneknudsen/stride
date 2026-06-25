import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as relations from "../../drizzle/relations";
import * as schema from "../../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL (or DATABASE_URL) is not set");
    }
    const sql = neon(connectionString);
    _db = drizzle(sql, {
      schema: { ...schema, ...relations },
      casing: "snake_case",
    });
  }
  return _db;
}

/**
 * Convenience singleton — lazy, won't connect until first use.
 * Justification for `any`: Proxy requires unsafe typing to delegate all properties
 * to the underlying Drizzle instance. The `as ReturnType<typeof getDb>` cast
 * provides type safety at the boundary — consumers see the full typed db object.
 */
// biome-ignore lint/suspicious/noExplicitAny: Proxy pattern requires unsafe typing, type-safe at boundary
export const db = new Proxy({} as any, {
  // biome-ignore lint/suspicious/noExplicitAny: Proxy target type erasure
  get(_target: any, prop: string | symbol) {
    // biome-ignore lint/suspicious/noExplicitAny: Property access delegation
    return (getDb() as any)[prop];
  },
}) as ReturnType<typeof getDb>;

export type Database = typeof db;
