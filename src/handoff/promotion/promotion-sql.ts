/**
 * Promotion Law — SQL schema.
 *
 * Tables:
 *   - promotion_records: durable promotion lifecycle records
 *   - promotion_events: audit trail for all promotion state transitions
 *   - promotion_comparisons: candidate vs baseline comparison snapshots
 */

import type Database from 'better-sqlite3';

const PROMOTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS promotion_records (
    promotion_id                TEXT PRIMARY KEY,
    proposal_ids                TEXT NOT NULL,
    source_calibration_report_id TEXT NOT NULL,
    candidate_policy_set_id     TEXT NOT NULL,
    baseline_policy_set_id      TEXT NOT NULL,
    scope                       TEXT NOT NULL DEFAULT 'global',
    status                      TEXT NOT NULL DEFAULT 'draft',
    trial_scope                 TEXT,
    created_at                  TEXT NOT NULL,
    trial_started_at            TEXT,
    trial_ended_at              TEXT,
    decision_at                 TEXT,
    created_by                  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_promotion_status
    ON promotion_records(status);
  CREATE INDEX IF NOT EXISTS idx_promotion_candidate
    ON promotion_records(candidate_policy_set_id);
  CREATE INDEX IF NOT EXISTS idx_promotion_baseline
    ON promotion_records(baseline_policy_set_id);

  CREATE TABLE IF NOT EXISTS promotion_events (
    promotion_id  TEXT NOT NULL,
    kind          TEXT NOT NULL,
    from_status   TEXT,
    to_status     TEXT NOT NULL,
    reason        TEXT NOT NULL,
    actor         TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_promotion_events_id
    ON promotion_events(promotion_id);

  CREATE TABLE IF NOT EXISTS promotion_comparisons (
    comparison_id             TEXT PRIMARY KEY,
    promotion_id              TEXT NOT NULL,
    candidate_policy_set_id   TEXT NOT NULL,
    baseline_policy_set_id    TEXT NOT NULL,
    window_from               TEXT,
    window_to                 TEXT,
    candidate_metrics         TEXT NOT NULL,
    baseline_metrics          TEXT NOT NULL,
    diffs                     TEXT NOT NULL,
    verdict                   TEXT NOT NULL,
    verdict_reason            TEXT NOT NULL,
    created_at                TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_promotion_comparisons_id
    ON promotion_comparisons(promotion_id);
`;

export function migratePromotionSchema(db: Database.Database): void {
  db.exec(PROMOTION_SCHEMA);
}
