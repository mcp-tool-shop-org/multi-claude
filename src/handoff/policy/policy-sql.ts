/**
 * Policy Control — SQL schema.
 *
 * Tables:
 *   - policy_sets: versioned policy content
 *   - policy_events: audit trail
 */

import type Database from 'better-sqlite3';

const POLICY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS policy_sets (
    policy_set_id   TEXT PRIMARY KEY,
    policy_version  INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    scope           TEXT NOT NULL DEFAULT 'global',
    content         TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    reason          TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    activated_at    TEXT,
    superseded_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_policy_sets_status
    ON policy_sets(status);
  CREATE INDEX IF NOT EXISTS idx_policy_sets_scope
    ON policy_sets(scope);

  CREATE TABLE IF NOT EXISTS policy_events (
    rowid          INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_set_id  TEXT NOT NULL,
    kind           TEXT NOT NULL,
    from_status    TEXT,
    to_status      TEXT NOT NULL,
    reason         TEXT NOT NULL,
    actor          TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_policy_events_policy
    ON policy_events(policy_set_id);
`;

export function migratePolicySchema(db: Database.Database): void {
  db.exec(POLICY_SCHEMA);
}
