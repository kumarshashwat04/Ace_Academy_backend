import { QueryResultRow } from "pg";
import { pool } from "./pool";
import { isProduction } from "../config";

/**
 * Thin wrapper around pool.query. All SQL in the app goes through here so we
 * have one place for query logging and error normalization.
 *
 * Always pass user-supplied values via `params` ($1, $2, ...) — never
 * interpolate them into `text`, to keep queries safe from SQL injection.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params as unknown[]);
    if (!isProduction) {
      const ms = Date.now() - start;
      console.debug(`[db] ${text.replace(/\s+/g, " ").trim()} (${result.rowCount} rows, ${ms}ms)`);
    }
    return result.rows;
  } catch (err) {
    console.error(`[db] Query failed: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Convenience for queries that should return exactly one row (or none).
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}
