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
