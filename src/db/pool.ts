import { Pool } from "pg";
import { config } from "../config";

/**
 * A single shared connection pool for the whole process.
 * `pg` reuses connections, so we never open one per request.
 */
export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
});

// Surface unexpected errors on idle clients rather than crashing silently.
pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client:", err.message);
});

/**
 * Lightweight connectivity check used by the /health endpoint.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("[db] Health check failed:", (err as Error).message);
    return false;
  }
}

/**
 * Closes the pool. Called on graceful shutdown.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
