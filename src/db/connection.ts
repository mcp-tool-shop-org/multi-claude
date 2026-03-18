import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrateDb(db: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');

  // Split on semicolons but skip PRAGMA statements (already set in openDb)
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('PRAGMA'));

  db.transaction(() => {
    for (const stmt of statements) {
      db.exec(stmt + ';');
    }
  })();
}

export function getSchemaVersion(db: Database.Database): number {
  const result = db.pragma('user_version', { simple: true });
  return typeof result === 'number' ? result : 0;
}

export function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

export function healthCheck(db: Database.Database): { tables: number; walMode: boolean } {
  const tables = db.prepare(
    `SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).get() as { cnt: number };

  const walMode = db.pragma('journal_mode', { simple: true }) === 'wal';

  return { tables: tables.cnt, walMode };
}
