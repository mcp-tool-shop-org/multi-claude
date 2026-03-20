/**
 * Supervisor Loop — SQL schema and migration.
 *
 * Two tables:
 *   - supervisor_claims: durable operator leases on queue items
 *   - supervisor_events: transition audit trail
 */

import type Database from 'better-sqlite3';

const MIGRATIONS = [
  // Supervisor claims (durable leases)
  `CREATE TABLE IF NOT EXISTS supervisor_claims (
    claim_id TEXT PRIMARY KEY,
    queue_item_id TEXT NOT NULL,
    claimed_by TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'released', 'expired', 'completed', 'interrupted', 'deferred', 'escalated')),
    lease_expires_at TEXT NOT NULL,
    deferred_until TEXT,
    escalation_target TEXT,
    last_reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_claims_queue_item ON supervisor_claims(queue_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_status ON supervisor_claims(status)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_actor ON supervisor_claims(claimed_by)`,

  // Supervisor events (audit trail)
  `CREATE TABLE IF NOT EXISTS supervisor_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    queue_item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_supervisor_events_claim ON supervisor_events(claim_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supervisor_events_queue ON supervisor_events(queue_item_id)`,
];

export function migrateSupervisorSchema(db: Database.Database): void {
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
}
