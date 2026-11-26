import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from .env file.
dotenv.config({ override: true });

let host = process.env.DB_HOST || process.env.SQL_HOST || "127.0.0.1";
let port = Number(process.env.DB_PORT || process.env.SQL_PORT || 5432);
let database = process.env.DB_NAME || process.env.SQL_DB_NAME || "";
let user = process.env.DB_USER || process.env.SQL_ADMIN_USER || process.env.SQL_USER || "";
let password = process.env.DB_PASSWORD || process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || "";

const rawDatabaseUrl = process.env.DATABASE_URL || "";
const isPlaceholderUrl =
  !rawDatabaseUrl ||
  rawDatabaseUrl.toLowerCase().includes("postgresql://user:password@") ||
  rawDatabaseUrl.toLowerCase().includes("[password]") ||
  rawDatabaseUrl.toLowerCase().includes("your-password") ||
  /\/database(\?|$)/i.test(rawDatabaseUrl);

if (!isPlaceholderUrl) {
  try {
    const parsed = new URL(rawDatabaseUrl);
    host = parsed.hostname || host;
    port = Number(parsed.port || port);
    database = parsed.pathname.replace(/^\/+/, "") || database;
    user = decodeURIComponent(parsed.username || "") || user;
    password = decodeURIComponent(parsed.password || "") || password;
  } catch (e) {}
}

if (!host) {
  throw new Error("DB_HOST or SQL_HOST must be set in environment variables.");
}
if (!database) {
  throw new Error("DB_NAME or SQL_DB_NAME must be set in environment variables.");
}
if (!user) {
  throw new Error("DB_USER or SQL_ADMIN_USER must be set in environment variables.");
}
if (!password) {
  throw new Error("DB_PASSWORD or SQL_ADMIN_PASSWORD must be set in environment variables.");
}

const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
const useSsl = !isLocal && process.env.DB_SSL === "true";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    host,
    port,
    user,
    password,
    database,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
});
