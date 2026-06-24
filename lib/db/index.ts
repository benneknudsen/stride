import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as relations from "../../drizzle/relations";
import * as schema from "../../drizzle/schema";

/**
 * Drizzle client backed by @neondatabase/serverless (HTTP driver).
 * Edge-compatible and well-suited to serverless/short-lived invocations.
 */

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("POSTGRES_URL (or DATABASE_URL) is not set");
}

const sql = neon(connectionString);

export const db = drizzle(sql, {
  schema: { ...schema, ...relations },
  casing: "snake_case",
});

export type Database = typeof db;
