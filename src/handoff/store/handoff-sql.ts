/**
 * Handoff Spine — SQL migration runner.
 *
 * Loads migration files in order and applies them to the database.
 * Uses CREATE TABLE IF NOT EXISTS so migrations are idempotent.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function migrateHandoffSchema(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  db.transaction(() => {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        db.exec(stmt + ';');
      }
    }
  })();
}

export function handoffTableCount(db: Database.Database): number {
  const result = db.prepare(
    `SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name LIKE 'handoff_%'`
  ).get() as { cnt: number };
  return result.cnt;
}
