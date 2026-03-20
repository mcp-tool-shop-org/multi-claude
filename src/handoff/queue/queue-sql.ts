/**
 * Decision Queue — SQL schema and migration.
 *
 * Two tables:
 *   - decision_queue_items: the queue itself
 *   - decision_queue_events: transition audit trail
 *
 * Plus a decision_briefs table for durable brief storage.
 */

import type Database from 'better-sqlite3';

const MIGRATIONS = [
  // Decision briefs (durable)
  `CREATE TABLE IF NOT EXISTS decision_briefs (
    brief_id TEXT PRIMARY KEY,
    handoff_id TEXT NOT NULL,
    packet_version INTEGER NOT NULL,
    baseline_packet_version INTEGER,
    brief_version TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reviewer', 'approver')),
    summary TEXT NOT NULL,
    delta_summary_json TEXT NOT NULL,
    blockers_json TEXT NOT NULL,
    evidence_coverage_json TEXT NOT NULL,
    eligibility_json TEXT NOT NULL,
    risks_json TEXT NOT NULL,
    open_loops_json TEXT NOT NULL,
    decision_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_briefs_handoff ON decision_briefs(handoff_id)`,

  // Queue items
  `CREATE TABLE IF NOT EXISTS decision_queue_items (
    queue_item_id TEXT PRIMARY KEY,
    handoff_id TEXT NOT NULL,
    packet_version INTEGER NOT NULL,
    brief_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reviewer', 'approver')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'recovery_requested', 'cleared', 'stale')),
    priority_class TEXT NOT NULL
      CHECK (priority_class IN ('recovery_needed', 'blocked_high', 'blocked_medium', 'approvable', 'informational')),
    blocker_summary TEXT NOT NULL DEFAULT '',
    eligibility_summary TEXT NOT NULL DEFAULT '',
    evidence_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_queue_status ON decision_queue_items(status)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_handoff ON decision_queue_items(handoff_id)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_priority ON decision_queue_items(priority_class, created_at)`,

  // Queue events (transition audit)
  `CREATE TABLE IF NOT EXISTS decision_queue_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    from_priority TEXT,
    to_priority TEXT,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    action_id TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_queue_events_item ON decision_queue_events(queue_item_id)`,
];

export function migrateQueueSchema(db: Database.Database): void {
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
}
