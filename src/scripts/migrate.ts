/**
 * Plain-SQL migration runner.
 *
 * Run with: npm run migrate
 *
 * Applies every migrations/*.sql file (sorted by filename) that isn't already
 * recorded in schema_migrations, each inside its own transaction.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pool, closePool } from "../db/pool";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );
}

async function appliedIds(): Promise<Set<string>> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  return new Set(rows.map((r) => r.id));
}

async function applyMigration(id: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedIds();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ranCount = 0;
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (applied.has(id)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`[migrate] Applying ${file}...`);
    await applyMigration(id, sql);
    ranCount++;
  }

  console.log(
    ranCount === 0
      ? "[migrate] Already up to date."
      : `[migrate] Applied ${ranCount} migration(s).`
  );
}

main()
  .catch((err) => {
    console.error("[migrate] Failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
