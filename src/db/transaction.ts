import { PoolClient } from "pg";
import { pool } from "./pool";

/**
 * Runs `fn` inside a single transaction on one checked-out client.
 * Commits on success, rolls back and rethrows on error, always releases.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
