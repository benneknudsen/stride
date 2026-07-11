// Kører Drizzle-migration på Vercel-deploy
// Drizzle-kit genererer SQL-filerne, denne kører dem mod databasen

import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { Pool } from "@neondatabase/serverless";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("⚠️ No POSTGRES_URL — skipping migration");
  process.exit(0);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

console.log("Running database migrations...");
await migrate(db, { migrationsFolder: "./drizzle/migrations" });
console.log("Migrations complete!");
await pool.end();