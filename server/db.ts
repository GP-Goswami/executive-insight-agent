import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Strip any accidental quotes from the env var and parse explicitly
const cleanUrl = process.env.DATABASE_URL.replace(/^['"]|['"]$/g, '');
const dbUrl = new URL(cleanUrl);

export const pool = new Pool({ 
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '5432', 10),
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.slice(1),
  ssl: dbUrl.hostname !== "localhost" && dbUrl.hostname !== "127.0.0.1",
});

export const db = drizzle(pool, { schema });

// Ensure google_oauth_tokens table exists (auto-migration on startup)
pool.query(`
  CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    google_email VARCHAR NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP,
    scopes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )
`).catch((err: Error) => console.error("[db] google_oauth_tokens migration error:", err));
