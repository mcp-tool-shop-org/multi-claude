/**
 * Outcome Ledger — Store.
 *
 * Durable outcome records and audit events.
 */

import type Database from 'better-sqlite3';
import { migrateOutcomeSchema } from './outcome-sql.js';
import type {
  Outcome,
  OutcomeStatus,
  OutcomeEvent,
  OutcomeEventKind,
} from './types.js';

export class OutcomeStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migrateOutcomeSchema(this.db);
  }

  // ── Outcomes ─────────────────────────────────────────────────────

  insertOutcome(o: Outcome): void {
    this.db.prepare(`
      INSERT INTO outcomes (
        outcome_id, queue_item_id, handoff_id, packet_version, brief_id,
        status, final_action, final_status, resolution_terminal, resolution_quality,
        policy_set_id, policy_version, closed_by,
        opened_at, closed_at, duration_ms,
        claim_count, defer_count, reroute_count, escalation_count,
        overflow_count, intervention_count, recovery_cycle_count, claim_churn_count,
        policy_changed_during_lifecycle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      o.outcomeId, o.queueItemId, o.handoffId, o.packetVersion, o.briefId,
      o.status, o.finalAction, o.finalStatus, o.resolutionTerminal, o.resolutionQuality,
      o.policySetId, o.policyVersion, o.closedBy,
      o.openedAt, o.closedAt, o.durationMs,
      o.claimCount, o.deferCount, o.rerouteCount, o.escalationCount,
      o.overflowCount, o.interventionCount, o.recoveryCycleCount, o.claimChurnCount,
      o.policyChangedDuringLifecycle ? 1 : 0,
    );
  }

  getOutcome(outcomeId: string): Outcome | undefined {
    const row = this.db.prepare(
      'SELECT * FROM outcomes WHERE outcome_id = ?',
    ).get(outcomeId) as OutcomeRow | undefined;
    return row ? mapOutcomeRow(row) : undefined;
  }

  getOutcomeByQueueItem(queueItemId: string): Outcome | undefined {
    const row = this.db.prepare(
      'SELECT * FROM outcomes WHERE queue_item_id = ?',
    ).get(queueItemId) as OutcomeRow | undefined;
    return row ? mapOutcomeRow(row) : undefined;
  }

  getOutcomeByHandoff(handoffId: string): Outcome | undefined {
    const row = this.db.prepare(
      'SELECT * FROM outcomes WHERE handoff_id = ? ORDER BY opened_at DESC LIMIT 1',
    ).get(handoffId) as OutcomeRow | undefined;
    return row ? mapOutcomeRow(row) : undefined;
  }

  listOutcomes(opts?: { status?: OutcomeStatus; policySetId?: string; limit?: number }): Outcome[] {
    let sql = 'SELECT * FROM outcomes WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.policySetId) { sql += ' AND policy_set_id = ?'; params.push(opts.policySetId); }
    sql += ' ORDER BY opened_at DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as OutcomeRow[]).map(mapOutcomeRow);
  }

  closeOutcome(outcomeId: string, updates: {
    finalAction: string;
    finalStatus: string;
    resolutionTerminal: string;
    resolutionQuality: string;
    policySetId: string | null;
    policyVersion: number | null;
    closedBy: string;
    closedAt: string;
    durationMs: number;
    claimCount: number;
    deferCount: number;
    rerouteCount: number;
    escalationCount: number;
    overflowCount: number;
    interventionCount: number;
    recoveryCycleCount: number;
    claimChurnCount: number;
    policyChangedDuringLifecycle: boolean;
  }): void {
    this.db.prepare(`
      UPDATE outcomes SET
        status = 'closed',
        final_action = ?, final_status = ?,
        resolution_terminal = ?, resolution_quality = ?,
        policy_set_id = ?, policy_version = ?,
        closed_by = ?, closed_at = ?, duration_ms = ?,
        claim_count = ?, defer_count = ?, reroute_count = ?, escalation_count = ?,
        overflow_count = ?, intervention_count = ?, recovery_cycle_count = ?, claim_churn_count = ?,
        policy_changed_during_lifecycle = ?
      WHERE outcome_id = ?
    `).run(
      updates.finalAction, updates.finalStatus,
      updates.resolutionTerminal, updates.resolutionQuality,
      updates.policySetId, updates.policyVersion,
      updates.closedBy, updates.closedAt, updates.durationMs,
      updates.claimCount, updates.deferCount, updates.rerouteCount, updates.escalationCount,
      updates.overflowCount, updates.interventionCount, updates.recoveryCycleCount, updates.claimChurnCount,
      updates.policyChangedDuringLifecycle ? 1 : 0,
      outcomeId,
    );
  }

  // ── Events ───────────────────────────────────────────────────────

  insertEvent(event: OutcomeEvent): void {
    this.db.prepare(`
      INSERT INTO outcome_events (outcome_id, kind, detail, actor, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.outcomeId, event.kind, event.detail, event.actor, event.createdAt);
  }

  getEvents(outcomeId: string): OutcomeEvent[] {
    return (this.db.prepare(
      'SELECT * FROM outcome_events WHERE outcome_id = ? ORDER BY rowid ASC',
    ).all(outcomeId) as EventRow[]).map(mapEventRow);
  }
}

// ── Row mappers ──────────────────────────────────────────────────────

interface OutcomeRow {
  outcome_id: string; queue_item_id: string; handoff_id: string;
  packet_version: number; brief_id: string;
  status: string; final_action: string | null; final_status: string | null;
  resolution_terminal: string | null; resolution_quality: string | null;
  policy_set_id: string | null; policy_version: number | null;
  closed_by: string | null;
  opened_at: string; closed_at: string | null; duration_ms: number | null;
  claim_count: number; defer_count: number; reroute_count: number;
  escalation_count: number; overflow_count: number; intervention_count: number;
  recovery_cycle_count: number; claim_churn_count: number;
  policy_changed_during_lifecycle: number;
}

function mapOutcomeRow(r: OutcomeRow): Outcome {
  return {
    outcomeId: r.outcome_id,
    queueItemId: r.queue_item_id,
    handoffId: r.handoff_id,
    packetVersion: r.packet_version,
    briefId: r.brief_id,
    status: r.status as Outcome['status'],
    finalAction: r.final_action,
    finalStatus: r.final_status,
    resolutionTerminal: r.resolution_terminal as Outcome['resolutionTerminal'],
    resolutionQuality: r.resolution_quality as Outcome['resolutionQuality'],
    policySetId: r.policy_set_id,
    policyVersion: r.policy_version,
    closedBy: r.closed_by,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    durationMs: r.duration_ms,
    claimCount: r.claim_count,
    deferCount: r.defer_count,
    rerouteCount: r.reroute_count,
    escalationCount: r.escalation_count,
    overflowCount: r.overflow_count,
    interventionCount: r.intervention_count,
    recoveryCycleCount: r.recovery_cycle_count,
    claimChurnCount: r.claim_churn_count,
    policyChangedDuringLifecycle: r.policy_changed_during_lifecycle === 1,
  };
}

interface EventRow {
  outcome_id: string; kind: string; detail: string;
  actor: string; created_at: string;
}

function mapEventRow(r: EventRow): OutcomeEvent {
  return {
    outcomeId: r.outcome_id,
    kind: r.kind as OutcomeEventKind,
    detail: r.detail,
    actor: r.actor,
    createdAt: r.created_at,
  };
}
