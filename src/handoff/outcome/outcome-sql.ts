/**
 * Outcome Ledger — SQL schema.
 *
 * Tables:
 *   - outcomes: durable closed-loop records
 *   - outcome_events: audit trail
 */

import type Database from 'better-sqlite3';

const OUTCOME_SCHEMA = `
  CREATE TABLE IF NOT EXISTS outcomes (
    outcome_id                TEXT PRIMARY KEY,
    queue_item_id             TEXT NOT NULL,
    handoff_id                TEXT NOT NULL,
    packet_version            INTEGER NOT NULL,
    brief_id                  TEXT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'open',
    final_action              TEXT,
    final_status              TEXT,
    resolution_terminal       TEXT,
    resolution_quality        TEXT,
    policy_set_id             TEXT,
    policy_version            INTEGER,
    closed_by                 TEXT,
    opened_at                 TEXT NOT NULL,
    closed_at                 TEXT,
    duration_ms               INTEGER,
    claim_count               INTEGER NOT NULL DEFAULT 0,
    defer_count               INTEGER NOT NULL DEFAULT 0,
    reroute_count             INTEGER NOT NULL DEFAULT 0,
    escalation_count          INTEGER NOT NULL DEFAULT 0,
    overflow_count            INTEGER NOT NULL DEFAULT 0,
    intervention_count        INTEGER NOT NULL DEFAULT 0,
    recovery_cycle_count      INTEGER NOT NULL DEFAULT 0,
    claim_churn_count         INTEGER NOT NULL DEFAULT 0,
    policy_changed_during_lifecycle INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_outcomes_queue_item
    ON outcomes(queue_item_id);
  CREATE INDEX IF NOT EXISTS idx_outcomes_handoff
    ON outcomes(handoff_id);
  CREATE INDEX IF NOT EXISTS idx_outcomes_status
    ON outcomes(status);
  CREATE INDEX IF NOT EXISTS idx_outcomes_policy
    ON outcomes(policy_set_id);

  CREATE TABLE IF NOT EXISTS outcome_events (
    rowid         INTEGER PRIMARY KEY AUTOINCREMENT,
    outcome_id    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    detail        TEXT NOT NULL,
    actor         TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_outcome_events_outcome
    ON outcome_events(outcome_id);
`;

export function migrateOutcomeSchema(db: Database.Database): void {
  db.exec(OUTCOME_SCHEMA);
}
