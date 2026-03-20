/**
 * Intervention Law — Store.
 *
 * Durable health snapshots, intervention records, and audit events.
 */

import type Database from 'better-sqlite3';
import { migrateInterventionSchema } from './intervention-sql.js';
import type { RoutingLane } from '../routing/types.js';
import type {
  HealthSnapshot,
  HealthState,
  Intervention,
  InterventionAction,
  InterventionEvent,
  InterventionEventKind,
  InterventionStatus,
  BreachCode,
} from './types.js';

export class InterventionStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migrateInterventionSchema(this.db);
  }

  // ── Health snapshots ────────────────────────────────────────────

  insertSnapshot(snapshot: HealthSnapshot): void {
    this.db.prepare(`
      INSERT INTO intervention_health_snapshots
        (snapshot_id, lane, health_state, breach_codes, active_count, pending_count, overflow_count, starved_count, wip_cap, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.snapshotId, snapshot.lane, snapshot.healthState,
      JSON.stringify(snapshot.breachCodes),
      snapshot.activeCount, snapshot.pendingCount, snapshot.overflowCount,
      snapshot.starvedCount, snapshot.wipCap, snapshot.createdAt,
    );
  }

  getLatestSnapshot(lane: RoutingLane): HealthSnapshot | undefined {
    const row = this.db.prepare(`
      SELECT * FROM intervention_health_snapshots
      WHERE lane = ? ORDER BY created_at DESC LIMIT 1
    `).get(lane) as SnapshotRow | undefined;
    return row ? mapSnapshotRow(row) : undefined;
  }

  listSnapshots(opts?: { lane?: RoutingLane; limit?: number }): HealthSnapshot[] {
    let sql = 'SELECT * FROM intervention_health_snapshots WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.lane) { sql += ' AND lane = ?'; params.push(opts.lane); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as SnapshotRow[]).map(mapSnapshotRow);
  }

  // ── Interventions ───────────────────────────────────────────────

  insertIntervention(intervention: Intervention): void {
    this.db.prepare(`
      INSERT INTO intervention_actions
        (intervention_id, lane, action, status, breach_codes, reason, actor, triggered_at, resolved_at, resolved_by, resolve_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intervention.interventionId, intervention.lane, intervention.action,
      intervention.status, JSON.stringify(intervention.breachCodes),
      intervention.reason, intervention.actor, intervention.triggeredAt,
      intervention.resolvedAt, intervention.resolvedBy, intervention.resolveReason,
    );
  }

  getIntervention(interventionId: string): Intervention | undefined {
    const row = this.db.prepare(
      'SELECT * FROM intervention_actions WHERE intervention_id = ?',
    ).get(interventionId) as InterventionRow | undefined;
    return row ? mapInterventionRow(row) : undefined;
  }

  getActiveIntervention(lane: RoutingLane): Intervention | undefined {
    const row = this.db.prepare(
      "SELECT * FROM intervention_actions WHERE lane = ? AND status = 'active' ORDER BY triggered_at DESC LIMIT 1",
    ).get(lane) as InterventionRow | undefined;
    return row ? mapInterventionRow(row) : undefined;
  }

  listInterventions(opts?: { lane?: RoutingLane; activeOnly?: boolean }): Intervention[] {
    let sql = 'SELECT * FROM intervention_actions WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.lane) { sql += ' AND lane = ?'; params.push(opts.lane); }
    if (opts?.activeOnly) { sql += " AND status = 'active'"; }
    sql += ' ORDER BY triggered_at DESC';
    return (this.db.prepare(sql).all(...params) as InterventionRow[]).map(mapInterventionRow);
  }

  resolveIntervention(
    interventionId: string,
    resolvedBy: string,
    resolveReason: string,
    resolvedAt: string,
  ): void {
    this.db.prepare(`
      UPDATE intervention_actions
      SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolve_reason = ?
      WHERE intervention_id = ?
    `).run(resolvedAt, resolvedBy, resolveReason, interventionId);
  }

  // ── Events ──────────────────────────────────────────────────────

  insertEvent(event: InterventionEvent): void {
    this.db.prepare(`
      INSERT INTO intervention_events
        (intervention_id, lane, kind, from_state, to_state, breach_codes, action, reason_code, reason, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.interventionId, event.lane, event.kind,
      event.fromState, event.toState, JSON.stringify(event.breachCodes),
      event.action, event.reasonCode, event.reason,
      event.actor, event.createdAt,
    );
  }

  getEvents(opts?: { lane?: RoutingLane; interventionId?: string; limit?: number }): InterventionEvent[] {
    let sql = 'SELECT * FROM intervention_events WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.lane) { sql += ' AND lane = ?'; params.push(opts.lane); }
    if (opts?.interventionId) { sql += ' AND intervention_id = ?'; params.push(opts.interventionId); }
    sql += ' ORDER BY rowid DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    return (this.db.prepare(sql).all(...params) as EventRow[]).map(mapEventRow);
  }
}

// ── Row mappers ─────────────────────────────────────────────────────

interface SnapshotRow {
  snapshot_id: string; lane: string; health_state: string; breach_codes: string;
  active_count: number; pending_count: number; overflow_count: number;
  starved_count: number; wip_cap: number; created_at: string;
}

function mapSnapshotRow(r: SnapshotRow): HealthSnapshot {
  return {
    snapshotId: r.snapshot_id, lane: r.lane as RoutingLane,
    healthState: r.health_state as HealthState,
    breachCodes: JSON.parse(r.breach_codes) as BreachCode[],
    activeCount: r.active_count, pendingCount: r.pending_count,
    overflowCount: r.overflow_count, starvedCount: r.starved_count,
    wipCap: r.wip_cap, createdAt: r.created_at,
  };
}

interface InterventionRow {
  intervention_id: string; lane: string; action: string; status: string;
  breach_codes: string; reason: string; actor: string; triggered_at: string;
  resolved_at: string | null; resolved_by: string | null; resolve_reason: string | null;
}

function mapInterventionRow(r: InterventionRow): Intervention {
  return {
    interventionId: r.intervention_id, lane: r.lane as RoutingLane,
    action: r.action as InterventionAction, status: r.status as InterventionStatus,
    breachCodes: JSON.parse(r.breach_codes) as BreachCode[],
    reason: r.reason, actor: r.actor, triggeredAt: r.triggered_at,
    resolvedAt: r.resolved_at, resolvedBy: r.resolved_by, resolveReason: r.resolve_reason,
  };
}

interface EventRow {
  intervention_id: string; lane: string; kind: string; from_state: string;
  to_state: string; breach_codes: string; action: string | null;
  reason_code: string; reason: string; actor: string; created_at: string;
}

function mapEventRow(r: EventRow): InterventionEvent {
  return {
    interventionId: r.intervention_id, lane: r.lane as RoutingLane,
    kind: r.kind as InterventionEventKind,
    fromState: r.from_state as HealthState, toState: r.to_state as HealthState,
    breachCodes: JSON.parse(r.breach_codes) as BreachCode[],
    action: r.action as InterventionAction | null,
    reasonCode: r.reason_code as any,
    reason: r.reason, actor: r.actor, createdAt: r.created_at,
  };
}
