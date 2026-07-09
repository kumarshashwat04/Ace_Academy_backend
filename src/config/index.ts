import dotenv from "dotenv";

dotenv.config();

/**
 * Reads a required environment variable, throwing at startup if it is missing.
 * Failing fast here means we never boot the server with a half-configured DB.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Reads an optional environment variable with a fallback default.
 */
function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function toNumber(value: string, name: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`Environment variable ${name} must be a number, got "${value}"`);
  }
  return n;
}

export const config = {
  env: optional("NODE_ENV", "development"),
  port: toNumber(optional("PORT", "3000"), "PORT"),
  corsOrigin: optional("CORS_ORIGIN", "*"),
  internalApiKey: required("INTERNAL_API_KEY"),

  db: {
    host: required("DB_HOST"),
    port: toNumber(optional("DB_PORT", "5432"), "DB_PORT"),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    ssl: optional("DB_SSL", "false").toLowerCase() === "true",
    poolMax: toNumber(optional("DB_POOL_MAX", "10"), "DB_POOL_MAX"),
    idleTimeoutMs: toNumber(optional("DB_IDLE_TIMEOUT_MS", "30000"), "DB_IDLE_TIMEOUT_MS"),
    connectionTimeoutMs: toNumber(
      optional("DB_CONNECTION_TIMEOUT_MS", "10000"),
      "DB_CONNECTION_TIMEOUT_MS"
    ),
  },
} as const;

export const isProduction = config.env === "production";
