import type { HookEventPayload, HookDecision, HookDecisionLog } from '../types/actions.js';
import type { PolicyMode } from './policy.js';
import { evaluateConditions } from './conditions.js';
import { evaluatePolicy } from './policy.js';
import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';

/** Re-export for backward compatibility */
export type { HookDecisionLog } from '../types/actions.js';

/** Process a hook event through the policy engine */
export function processHookEvent(
  dbPath: string,
  event: HookEventPayload,
  mode: PolicyMode = 'advisory',
): { decision: HookDecision | null; log: HookDecisionLog } {
  // 1. Evaluate conditions
  const conditions = evaluateConditions(
    dbPath,
    event.featureId,
    event.event === 'packet.failed' ? event.entityId : undefined,
  );

  // 2. Run policy rules
  const result = evaluatePolicy(event, conditions, mode);

  // 3. Build decision log
  const log: HookDecisionLog = {
    id: generateId('hook'),
    timestamp: nowISO(),
    event: event.event,
    eventEntityId: event.entityId,
    featureId: event.featureId,
    conditionsJson: JSON.stringify(conditions),
    ruleMatched: result?.rule.id ?? null,
    action: result?.decision.action ?? null,
    packetsJson: JSON.stringify(result?.decision.packets ?? []),
    mode,
    operatorDecision: mode === 'autonomous' && result?.rule.mode === 'autonomous' ? 'auto' : 'pending',
    executed: false,
    reason: result?.decision.reason ?? null,
  };

  // 4. Persist decision log
  try {
    const db = openDb(dbPath);
    try {
      // Create table if not exists
      db.exec(`
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
        )
      `);

      db.prepare(`
        INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id, conditions_json, rule_matched, action, packets_json, mode, operator_decision, executed, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        log.id, log.timestamp, log.event, log.eventEntityId, log.featureId,
        log.conditionsJson, log.ruleMatched, log.action, log.packetsJson,
        log.mode, log.operatorDecision, log.executed ? 1 : 0, log.reason,
      );
    } finally {
      db.close();
    }
  } catch {
    // Log persistence failure should not crash the hook engine
  }

  return { decision: result?.decision ?? null, log };
}

/** Emit a hook event — convenience wrapper */
export function emitHookEvent(
  dbPath: string,
  event: HookEventPayload['event'],
  entityType: HookEventPayload['entityType'],
  entityId: string,
  featureId: string,
  mode: PolicyMode = 'advisory',
  metadata?: Record<string, unknown>,
): { decision: HookDecision | null; log: HookDecisionLog } {
  const payload: HookEventPayload = {
    event,
    entityType,
    entityId,
    featureId,
    timestamp: nowISO(),
    metadata,
  };
  return processHookEvent(dbPath, payload, mode);
}

/** Get recent hook decisions for display */
export function getRecentDecisions(dbPath: string, limit: number = 20): HookDecisionLog[] {
  try {
    const db = openDb(dbPath);
    try {
      db.exec(`
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
        )
      `);

      return db.prepare(`
        SELECT * FROM hook_decisions ORDER BY timestamp DESC LIMIT ?
      `).all(limit) as HookDecisionLog[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** Mark a decision as confirmed/rejected by operator */
export function resolveDecision(dbPath: string, decisionId: string, resolution: 'confirmed' | 'rejected'): boolean {
  try {
    const db = openDb(dbPath);
    try {
      db.prepare(`UPDATE hook_decisions SET operator_decision = ?, executed = ? WHERE id = ?`)
        .run(resolution, resolution === 'confirmed' ? 1 : 0, decisionId);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
