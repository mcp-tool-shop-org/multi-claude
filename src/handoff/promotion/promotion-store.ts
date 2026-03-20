/**
 * Promotion Law — Store.
 *
 * Durable persistence for promotion records, events, and comparisons.
 */

import type Database from 'better-sqlite3';
import { migratePromotionSchema } from './promotion-sql.js';
import type {
  PromotionRecord,
  PromotionStatus,
  PromotionEvent,
  TrialComparison,
  TrialScope,
  ComparisonMetrics,
  ComparisonDiff,
} from './types.js';

interface PromotionRow {
  promotion_id: string;
  proposal_ids: string;
  source_calibration_report_id: string;
  candidate_policy_set_id: string;
  baseline_policy_set_id: string;
  scope: string;
  status: string;
  trial_scope: string | null;
  created_at: string;
  trial_started_at: string | null;
  trial_ended_at: string | null;
  decision_at: string | null;
  created_by: string;
}

interface EventRow {
  promotion_id: string;
  kind: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  actor: string;
  detail: string | null;
  created_at: string;
}

interface ComparisonRow {
  comparison_id: string;
  promotion_id: string;
  candidate_policy_set_id: string;
  baseline_policy_set_id: string;
  window_from: string | null;
  window_to: string | null;
  candidate_metrics: string;
  baseline_metrics: string;
  diffs: string;
  verdict: string;
  verdict_reason: string;
  created_at: string;
}

function mapPromotionRow(row: PromotionRow): PromotionRecord {
  return {
    promotionId: row.promotion_id,
    proposalIds: JSON.parse(row.proposal_ids) as string[],
    sourceCalibrationReportId: row.source_calibration_report_id,
    candidatePolicySetId: row.candidate_policy_set_id,
    baselinePolicySetId: row.baseline_policy_set_id,
    scope: row.scope,
    status: row.status as PromotionStatus,
    trialScope: row.trial_scope ? JSON.parse(row.trial_scope) as TrialScope : null,
    createdAt: row.created_at,
    trialStartedAt: row.trial_started_at,
    trialEndedAt: row.trial_ended_at,
    decisionAt: row.decision_at,
    createdBy: row.created_by,
  };
}

function mapEventRow(row: EventRow): PromotionEvent {
  return {
    promotionId: row.promotion_id,
    kind: row.kind as PromotionEvent['kind'],
    fromStatus: row.from_status as PromotionStatus | null,
    toStatus: row.to_status as PromotionStatus,
    reason: row.reason,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function mapComparisonRow(row: ComparisonRow): TrialComparison {
  return {
    comparisonId: row.comparison_id,
    promotionId: row.promotion_id,
    candidatePolicySetId: row.candidate_policy_set_id,
    baselinePolicySetId: row.baseline_policy_set_id,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    candidateMetrics: JSON.parse(row.candidate_metrics) as ComparisonMetrics,
    baselineMetrics: JSON.parse(row.baseline_metrics) as ComparisonMetrics,
    diffs: JSON.parse(row.diffs) as ComparisonDiff[],
    verdict: row.verdict as TrialComparison['verdict'],
    verdictReason: row.verdict_reason,
    createdAt: row.created_at,
  };
}

export class PromotionStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migratePromotionSchema(this.db);
  }

  // ── Promotion records ───────────────────────────────────────────

  insertPromotion(r: PromotionRecord): void {
    this.db.prepare(`
      INSERT INTO promotion_records
        (promotion_id, proposal_ids, source_calibration_report_id,
         candidate_policy_set_id, baseline_policy_set_id, scope, status,
         trial_scope, created_at, trial_started_at, trial_ended_at,
         decision_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.promotionId, JSON.stringify(r.proposalIds), r.sourceCalibrationReportId,
      r.candidatePolicySetId, r.baselinePolicySetId, r.scope, r.status,
      r.trialScope ? JSON.stringify(r.trialScope) : null,
      r.createdAt, r.trialStartedAt, r.trialEndedAt,
      r.decisionAt, r.createdBy,
    );
  }

  getPromotion(promotionId: string): PromotionRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM promotion_records WHERE promotion_id = ?',
    ).get(promotionId) as PromotionRow | undefined;
    return row ? mapPromotionRow(row) : undefined;
  }

  listPromotions(opts?: {
    status?: PromotionStatus;
    scope?: string;
    limit?: number;
  }): PromotionRecord[] {
    let sql = 'SELECT * FROM promotion_records WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.scope) { sql += ' AND scope = ?'; params.push(opts.scope); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as PromotionRow[]).map(mapPromotionRow);
  }

  getActiveTrials(scope?: string): PromotionRecord[] {
    let sql = "SELECT * FROM promotion_records WHERE status = 'trial_active'";
    const params: unknown[] = [];
    if (scope) { sql += ' AND scope = ?'; params.push(scope); }
    return (this.db.prepare(sql).all(...params) as PromotionRow[]).map(mapPromotionRow);
  }

  updateStatus(promotionId: string, updates: {
    status: PromotionStatus;
    trialScope?: TrialScope;
    trialStartedAt?: string;
    trialEndedAt?: string;
    decisionAt?: string;
  }): void {
    const fields: string[] = ['status = ?'];
    const params: unknown[] = [updates.status];

    if (updates.trialScope !== undefined) {
      fields.push('trial_scope = ?');
      params.push(JSON.stringify(updates.trialScope));
    }
    if (updates.trialStartedAt !== undefined) {
      fields.push('trial_started_at = ?');
      params.push(updates.trialStartedAt);
    }
    if (updates.trialEndedAt !== undefined) {
      fields.push('trial_ended_at = ?');
      params.push(updates.trialEndedAt);
    }
    if (updates.decisionAt !== undefined) {
      fields.push('decision_at = ?');
      params.push(updates.decisionAt);
    }

    params.push(promotionId);
    this.db.prepare(
      `UPDATE promotion_records SET ${fields.join(', ')} WHERE promotion_id = ?`,
    ).run(...params);
  }

  // ── Events ──────────────────────────────────────────────────────

  insertEvent(event: PromotionEvent): void {
    this.db.prepare(`
      INSERT INTO promotion_events
        (promotion_id, kind, from_status, to_status, reason, actor, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.promotionId, event.kind, event.fromStatus, event.toStatus,
      event.reason, event.actor, event.detail, event.createdAt,
    );
  }

  getEvents(promotionId: string): PromotionEvent[] {
    return (this.db.prepare(
      'SELECT * FROM promotion_events WHERE promotion_id = ? ORDER BY created_at ASC',
    ).all(promotionId) as EventRow[]).map(mapEventRow);
  }

  // ── Comparisons ─────────────────────────────────────────────────

  insertComparison(c: TrialComparison): void {
    this.db.prepare(`
      INSERT INTO promotion_comparisons
        (comparison_id, promotion_id, candidate_policy_set_id, baseline_policy_set_id,
         window_from, window_to, candidate_metrics, baseline_metrics,
         diffs, verdict, verdict_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.comparisonId, c.promotionId, c.candidatePolicySetId, c.baselinePolicySetId,
      c.windowFrom, c.windowTo,
      JSON.stringify(c.candidateMetrics), JSON.stringify(c.baselineMetrics),
      JSON.stringify(c.diffs), c.verdict, c.verdictReason, c.createdAt,
    );
  }

  getComparisons(promotionId: string): TrialComparison[] {
    return (this.db.prepare(
      'SELECT * FROM promotion_comparisons WHERE promotion_id = ? ORDER BY created_at ASC',
    ).all(promotionId) as ComparisonRow[]).map(mapComparisonRow);
  }

  getLatestComparison(promotionId: string): TrialComparison | undefined {
    const row = this.db.prepare(
      'SELECT * FROM promotion_comparisons WHERE promotion_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(promotionId) as ComparisonRow | undefined;
    return row ? mapComparisonRow(row) : undefined;
  }
}
