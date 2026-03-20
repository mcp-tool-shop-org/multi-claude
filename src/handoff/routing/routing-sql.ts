/**
 * Routing Law — SQL schema and migration.
 *
 * Two tables:
 *   - routing_routes: durable lane assignments
 *   - routing_events: transition audit trail
 */

import type Database from 'better-sqlite3';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS routing_routes (
    route_id TEXT PRIMARY KEY,
    queue_item_id TEXT NOT NULL,
    lane TEXT NOT NULL CHECK (lane IN ('reviewer', 'approver', 'recovery', 'escalated_review')),
    assigned_target TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'rerouted', 'completed', 'interrupted')),
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    routed_by TEXT NOT NULL,
    routed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_routes_queue_item ON routing_routes(queue_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_routes_lane ON routing_routes(lane, status)`,
  `CREATE INDEX IF NOT EXISTS idx_routes_status ON routing_routes(status)`,

  `CREATE TABLE IF NOT EXISTS routing_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT NOT NULL,
    queue_item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_lane TEXT,
    to_lane TEXT NOT NULL,
    from_target TEXT,
    to_target TEXT,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_routing_events_route ON routing_events(route_id)`,
  `CREATE INDEX IF NOT EXISTS idx_routing_events_queue ON routing_events(queue_item_id)`,
];

export function migrateRoutingSchema(db: Database.Database): void {
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
}
