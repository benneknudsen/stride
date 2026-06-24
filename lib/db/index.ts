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

/** Convenience singleton — lazy, won't connect until first use */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return (getDb() as never)[prop];
  },
});

export type Database = typeof db;
