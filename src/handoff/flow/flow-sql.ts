/**
 * Flow Control — SQL schema.
 *
 * Tables:
 *   - flow_lane_caps: durable WIP cap per lane
 *   - flow_overflow: items denied admission, waiting for capacity
 *   - flow_events: audit trail of all flow decisions
 */

import type Database from 'better-sqlite3';

const FLOW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS flow_lane_caps (
    lane          TEXT PRIMARY KEY,
    wip_cap       INTEGER NOT NULL DEFAULT 5,
    updated_at    TEXT NOT NULL,
    updated_by    TEXT NOT NULL,
    reason        TEXT NOT NULL DEFAULT 'initial'
  );

  CREATE TABLE IF NOT EXISTS flow_overflow (
    queue_item_id TEXT PRIMARY KEY,
    lane          TEXT NOT NULL,
    reason_code   TEXT NOT NULL,
    reason        TEXT NOT NULL,
    entered_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_flow_overflow_lane
    ON flow_overflow(lane);

  CREATE TABLE IF NOT EXISTS flow_events (
    rowid            INTEGER PRIMARY KEY AUTOINCREMENT,
    lane             TEXT NOT NULL,
    kind             TEXT NOT NULL,
    prior_active     INTEGER NOT NULL,
    new_active       INTEGER NOT NULL,
    wip_cap          INTEGER NOT NULL,
    reason_code      TEXT NOT NULL,
    reason           TEXT NOT NULL,
    actor            TEXT NOT NULL,
    queue_item_id    TEXT,
    created_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_flow_events_lane
    ON flow_events(lane);
  CREATE INDEX IF NOT EXISTS idx_flow_events_kind
    ON flow_events(kind);
  CREATE INDEX IF NOT EXISTS idx_flow_events_queue_item
    ON flow_events(queue_item_id);
`;

export function migrateFlowSchema(db: Database.Database): void {
  db.exec(FLOW_SCHEMA);
}
