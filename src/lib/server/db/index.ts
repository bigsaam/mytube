import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '$lib/server/config';
import * as schema from './schema';

/**
 * Single shared SQLite connection for the whole process. WAL mode + a busy
 * timeout let the worker loop and request handlers share the file safely.
 */
function createDb() {
	fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
	const sqlite = new Database(config.databasePath);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('foreign_keys = ON');
	return drizzle(sqlite, { schema });
}

// Reuse across HMR reloads in dev to avoid leaking file handles.
const globalForDb = globalThis as unknown as { __haystackDb?: ReturnType<typeof createDb> };

export const db = globalForDb.__haystackDb ?? createDb();
if (import.meta.env?.DEV) globalForDb.__haystackDb = db;

export { schema };
