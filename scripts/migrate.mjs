// Kører Drizzle-migration på Vercel-deploy
// Drizzle-kit genererer SQL-filerne, denne kører dem mod databasen

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("⚠️ No POSTGRES_URL — skipping migration");
  process.exit(0);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

// pgvector must exist before the migration history replays: the `vector(1536)`
// column on `activity_embeddings` is created by migration 0000. Nothing reads
// that table any more (issue #292 — the table is dropped in 0009 and the
// extension is left installed, not dropped), but a fresh database still has to
// walk 0000, so the extension has to be there first.
console.log("Ensuring pgvector extension...");
await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

console.log("Running database migrations...");
await migrate(db, { migrationsFolder: "./drizzle/migrations" });
console.log("Migrations complete!");

// Issue #277 — one-time hygiene scrubs, not schema migrations. Rows written
// before #262 may still hold plaintext OAuth tokens (access/refresh/id), so
// NULL them out for every account. Idempotent: a second run matches no rows.
// This must never fail the build/deploy (a scrub failure is not a schema
// failure), so errors are logged and swallowed. The columns stay because the
// Auth.js adapter contract (`linkAccount` insert) still requires them.
try {
  const result = await pool.query(
    `UPDATE accounts
        SET access_token = NULL, refresh_token = NULL, id_token = NULL
      WHERE access_token IS NOT NULL
         OR refresh_token IS NOT NULL
         OR id_token IS NOT NULL`
  );
  // Never log token values — only the number of scrubbed rows.
  console.log(`Scrubbed plaintext OAuth tokens from ${result.rowCount ?? 0} account row(s).`);
} catch (err) {
  console.warn(
    `Account token scrub skipped: ${err instanceof Error ? err.message : "unknown error"}`
  );
}

await pool.end();
