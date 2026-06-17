/**
 * Schema introspection helper.
 *
 * Run with: npm run introspect
 *
 * Connects to the configured ace_academy DB and prints every table in the
 * `public` schema along with its columns and types. Use the output to build
 * accurate per-table modules (update the `columns` allowlist and row interface
 * in each module's repository).
 */
import { pool, closePool } from "../db/pool";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_primary_key: boolean;
}

async function main(): Promise<void> {
  const sql = `
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      COALESCE(pk.is_pk, false) AS is_primary_key
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.table_name, kcu.column_name, true AS is_pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
    ) pk
      ON pk.table_name = c.table_name AND pk.column_name = c.column_name
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position;
  `;

  const { rows } = await pool.query<ColumnRow>(sql);

  if (rows.length === 0) {
    console.log("No tables found in the 'public' schema.");
    return;
  }

  const byTable = new Map<string, ColumnRow[]>();
  for (const row of rows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push(row);
    byTable.set(row.table_name, list);
  }

  console.log(`\nFound ${byTable.size} table(s) in ace_academy (public schema):\n`);
  for (const [table, cols] of byTable) {
    console.log(`📋 ${table}`);
    for (const col of cols) {
      const pk = col.is_primary_key ? " [PK]" : "";
      const nullable = col.is_nullable === "YES" ? "" : " NOT NULL";
      console.log(`   - ${col.column_name}: ${col.data_type}${nullable}${pk}`);
    }
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("[introspect] Failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
