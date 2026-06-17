import { createApp } from "./app";
import { config } from "./config";
import { closePool } from "./db/pool";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[server] ACE Academy API listening on port ${config.port} (${config.env})`);
});

/**
 * Graceful shutdown: stop accepting connections, then close the DB pool.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received, shutting down...`);
  server.close(async () => {
    await closePool();
    console.log("[server] Closed. Bye.");
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
