/**
 * Intervention Law — SQL schema.
 *
 * Tables:
 *   - intervention_health_snapshots: point-in-time lane health
 *   - intervention_actions: active/resolved interventions
 *   - intervention_events: audit trail
 */

import type Database from 'better-sqlite3';

const INTERVENTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS intervention_health_snapshots (
    snapshot_id     TEXT PRIMARY KEY,
    lane            TEXT NOT NULL,
    health_state    TEXT NOT NULL,
    breach_codes    TEXT NOT NULL DEFAULT '[]',
    active_count    INTEGER NOT NULL,
    pending_count   INTEGER NOT NULL,
    overflow_count  INTEGER NOT NULL,
    starved_count   INTEGER NOT NULL,
    wip_cap         INTEGER NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_intervention_snapshots_lane
    ON intervention_health_snapshots(lane);
  CREATE INDEX IF NOT EXISTS idx_intervention_snapshots_state
    ON intervention_health_snapshots(health_state);

  CREATE TABLE IF NOT EXISTS intervention_actions (
    intervention_id TEXT PRIMARY KEY,
    lane            TEXT NOT NULL,
    action          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    breach_codes    TEXT NOT NULL DEFAULT '[]',
    reason          TEXT NOT NULL,
    actor           TEXT NOT NULL,
    triggered_at    TEXT NOT NULL,
    resolved_at     TEXT,
    resolved_by     TEXT,
    resolve_reason  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_intervention_actions_lane
    ON intervention_actions(lane);
  CREATE INDEX IF NOT EXISTS idx_intervention_actions_status
    ON intervention_actions(status);

  CREATE TABLE IF NOT EXISTS intervention_events (
    rowid            INTEGER PRIMARY KEY AUTOINCREMENT,
    intervention_id  TEXT NOT NULL,
    lane             TEXT NOT NULL,
    kind             TEXT NOT NULL,
    from_state       TEXT NOT NULL,
    to_state         TEXT NOT NULL,
    breach_codes     TEXT NOT NULL DEFAULT '[]',
    action           TEXT,
    reason_code      TEXT NOT NULL,
    reason           TEXT NOT NULL,
    actor            TEXT NOT NULL,
    created_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_intervention_events_lane
    ON intervention_events(lane);
  CREATE INDEX IF NOT EXISTS idx_intervention_events_intervention
    ON intervention_events(intervention_id);
`;

export function migrateInterventionSchema(db: Database.Database): void {
  db.exec(INTERVENTION_SCHEMA);
}
