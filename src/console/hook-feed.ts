import { openDb } from '../db/connection.js';
import { nowISO } from '../lib/ids.js';

// ── Types ──────────────────────────────────────────────────────────────

/** A hook decision rendered for console display. Renamed from HookEvent to
 *  avoid collision with the canonical HookEvent (event name union) in types/actions.ts. */
export interface HookFeedEvent {
  id: string;
  timestamp: string;
  event: string;
  entityId: string;
  featureId: string;
  ruleMatched: string | null;
  action: string | null;
  packets: string[];
  mode: 'advisory' | 'autonomous';
  operatorDecision: 'pending' | 'confirmed' | 'rejected' | 'auto';
  executed: boolean;
  reason: string | null;
  conditions: Record<string, unknown> | null;
}

/** @deprecated Use HookFeedEvent instead — kept for backward compatibility */
export type HookEvent = HookFeedEvent;

export interface HookFeedSummary {
  totalDecisions: number;
  pendingApprovals: number;
  autoExecuted: number;
  confirmedByOperator: number;
  rejectedByOperator: number;
  byEvent: Record<string, number>;
  byAction: Record<string, number>;
  byRule: Record<string, number>;
}

export interface HookFeedResult {
  events: HookFeedEvent[];
  summary: HookFeedSummary;
  queriedAt: string;
}

// ── Internal helpers ───────────────────────────────────────────────────

const HOOK_DECISIONS_DDL = `
CREATE TABLE IF NOT EXISTS hook_decisions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  event_entity_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  rule_matched TEXT,
  action TEXT,
  packets_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  operator_decision TEXT NOT NULL DEFAULT 'pending',
  executed INTEGER NOT NULL DEFAULT 0,
  reason TEXT
)`;

interface RawRow {
  id: string;
  timestamp: string;
  event: string;
  event_entity_id: string;
  feature_id: string;
  conditions_json: string;
  rule_matched: string | null;
  action: string | null;
  packets_json: string;
  mode: string;
  operator_decision: string;
  executed: number;
  reason: string | null;
}

function ensureTable(dbPath: string) {
  const db = openDb(dbPath);
  db.exec(HOOK_DECISIONS_DDL);
  return db;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToEvent(row: RawRow): HookFeedEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    event: row.event,
    entityId: row.event_entity_id,
    featureId: row.feature_id,
    ruleMatched: row.rule_matched ?? null,
    action: row.action ?? null,
    packets: parseJson<string[]>(row.packets_json, []),
    mode: row.mode as HookFeedEvent['mode'],
    operatorDecision: row.operator_decision as HookFeedEvent['operatorDecision'],
    executed: row.executed === 1,
    reason: row.reason ?? null,
    conditions: parseJson<Record<string, unknown> | null>(row.conditions_json, null),
  };
}

function buildSummary(events: HookFeedEvent[]): HookFeedSummary {
  const summary: HookFeedSummary = {
    totalDecisions: events.length,
    pendingApprovals: 0,
    autoExecuted: 0,
    confirmedByOperator: 0,
    rejectedByOperator: 0,
    byEvent: {},
    byAction: {},
    byRule: {},
  };

  for (const ev of events) {
    // Decision counts
    if (ev.operatorDecision === 'pending') summary.pendingApprovals++;
    if (ev.operatorDecision === 'auto' && ev.executed) summary.autoExecuted++;
    if (ev.operatorDecision === 'confirmed') summary.confirmedByOperator++;
    if (ev.operatorDecision === 'rejected') summary.rejectedByOperator++;

    // Aggregations
    summary.byEvent[ev.event] = (summary.byEvent[ev.event] ?? 0) + 1;
    if (ev.action) {
      summary.byAction[ev.action] = (summary.byAction[ev.action] ?? 0) + 1;
    }
    if (ev.ruleMatched) {
      summary.byRule[ev.ruleMatched] = (summary.byRule[ev.ruleMatched] ?? 0) + 1;
    }
  }

  return summary;
}

// ── Public API ─────────────────────────────────────────────────────────

export function queryHookFeed(
  dbPath: string,
  featureId: string,
  options?: {
    limit?: number;
    sinceTimestamp?: string;
    eventFilter?: string;
    pendingOnly?: boolean;
  },
): HookFeedResult {
  const db = ensureTable(dbPath);

  try {
    const clauses: string[] = ['feature_id = ?'];
    const params: unknown[] = [featureId];

    if (options?.sinceTimestamp) {
      clauses.push('timestamp > ?');
      params.push(options.sinceTimestamp);
    }
    if (options?.eventFilter) {
      clauses.push('event = ?');
      params.push(options.eventFilter);
    }
    if (options?.pendingOnly) {
      clauses.push("operator_decision = 'pending'");
    }

    const where = clauses.join(' AND ');
    const limit = options?.limit ?? 100;

    const sql = `SELECT * FROM hook_decisions WHERE ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as RawRow[];
    const events = rows.map(rowToEvent);

    return {
      events,
      summary: buildSummary(events),
      queriedAt: nowISO(),
    };
  } finally {
    db.close();
  }
}

export function queryPendingApprovals(dbPath: string, featureId: string): HookFeedEvent[] {
  const db = ensureTable(dbPath);

  try {
    const sql = `SELECT * FROM hook_decisions WHERE feature_id = ? AND operator_decision = 'pending' ORDER BY timestamp DESC`;
    const rows = db.prepare(sql).all(featureId) as RawRow[];
    return rows.map(rowToEvent);
  } finally {
    db.close();
  }
}

export function queryPacketDecisionTrail(dbPath: string, packetId: string): HookFeedEvent[] {
  const db = ensureTable(dbPath);

  try {
    // packets_json is a JSON array — search for the packetId within it
    const sql = `SELECT * FROM hook_decisions WHERE packets_json LIKE ? ORDER BY timestamp DESC`;
    const rows = db.prepare(sql).all(`%${packetId}%`) as RawRow[];

    // Filter precisely: the LIKE match is coarse, verify via parsed JSON
    return rows
      .map(rowToEvent)
      .filter((ev) => ev.packets.includes(packetId));
  } finally {
    db.close();
  }
}
