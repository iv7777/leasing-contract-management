import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import fs from "node:fs";
import path from "node:path";

// Every entry point (index.ts, migrate.ts, seed.ts, backup.ts,
// resetPassword.ts) imports this module before touching process.env, so
// loading .env here — once — means none of them silently fall back to
// defaults when run standalone outside the main server process.

const dbPath = process.env.DATABASE_PATH ?? "./data/app.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
// Required for reasonable concurrent read/write behavior; keep write
// transactions short per project brief.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
