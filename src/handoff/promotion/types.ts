/**
 * Promotion Law — Phase 12 canonical types.
 *
 * Promotion connects calibration truth to lawful change adoption.
 * Every candidate policy must be trialed in bounded scope, compared
 * against an explicit baseline, and explicitly promoted or rolled back.
 *
 * Law: no policy change reaches production without evidence-bound
 * trial, deterministic comparison, and explicit human decision.
 */

import type { RoutingLane } from '../routing/types.js';

// ── Promotion status ────────────────────────────────────────────────

export type PromotionStatus =
  | 'draft'               // candidate created, not yet validated
  | 'ready_for_trial'     // candidate validated, awaiting trial start
  | 'trial_active'        // trial is running in scoped context
  | 'trial_completed'     // trial ended, awaiting comparison
  | 'promotion_eligible'  // comparison passed, ready for promotion
  | 'promoted'            // candidate policy is now active
  | 'rolled_back'         // trial regressed or was explicitly rejected
  | 'rejected';           // candidate rejected without promotion

export const TERMINAL_PROMOTION_STATUSES: readonly PromotionStatus[] = [
  'promoted', 'rolled_back', 'rejected',
];

// ── Trial scope ─────────────────────────────────────────────────────

export type TrialScopeKind =
  | 'lane'           // trial limited to a specific lane
  | 'time_window'    // trial limited by time
  | 'admission_cap'; // trial limited by number of admissions

export interface TrialScope {
  kind: TrialScopeKind;
  /** Lane restriction (when kind='lane') */
  lane: RoutingLane | null;
  /** Maximum duration in ms (when kind='time_window') */
  maxDurationMs: number | null;
  /** Maximum admissions under candidate (when kind='admission_cap') */
  maxAdmissions: number | null;
}

// ── Promotion record ────────────────────────────────────────────────

export interface PromotionRecord {
  promotionId: string;
  /** Adjustment IDs from the calibration report that seeded this */
  proposalIds: string[];
  /** Calibration report that generated the proposals */
  sourceCalibrationReportId: string;
  /** The candidate policy set created for trial */
  candidatePolicySetId: string;
  /** The baseline policy set being compared against */
  baselinePolicySetId: string;
  /** Policy scope */
  scope: string;
  /** Current status */
  status: PromotionStatus;
  /** Trial scope (set at trial start) */
  trialScope: TrialScope | null;
  /** Timestamps */
  createdAt: string;
  trialStartedAt: string | null;
  trialEndedAt: string | null;
  decisionAt: string | null;
  /** Actor who created the promotion */
  createdBy: string;
}

// ── Promotion event ─────────────────────────────────────────────────

export type PromotionEventKind =
  | 'created'
  | 'validated'
  | 'trial_started'
  | 'trial_stopped'
  | 'comparison_run'
  | 'promotion_eligible'
  | 'promoted'
  | 'rolled_back'
  | 'rejected';

export interface PromotionEvent {
  promotionId: string;
  kind: PromotionEventKind;
  fromStatus: PromotionStatus | null;
  toStatus: PromotionStatus;
  reason: string;
  actor: string;
  detail: string | null;
  createdAt: string;
}

// ── Trial comparison ────────────────────────────────────────────────

export interface TrialComparison {
  comparisonId: string;
  promotionId: string;
  candidatePolicySetId: string;
  baselinePolicySetId: string;
  /** Evidence window */
  windowFrom: string | null;
  windowTo: string | null;
  /** Candidate metrics */
  candidateMetrics: ComparisonMetrics;
  /** Baseline metrics */
  baselineMetrics: ComparisonMetrics;
  /** Structured diffs */
  diffs: ComparisonDiff[];
  /** Overall verdict */
  verdict: ComparisonVerdict;
  /** Reason for verdict */
  verdictReason: string;
  createdAt: string;
}

export interface ComparisonMetrics {
  totalOutcomes: number;
  closedOutcomes: number;
  cleanRate: number;
  churnRate: number;
  recoveryRate: number;
  interventionRate: number;
  overflowCount: number;
  starvationCount: number;
  meanLeadTimeMs: number | null;
}

export interface ComparisonDiff {
  metric: string;
  candidateValue: number | null;
  baselineValue: number | null;
  /** Positive = improvement, negative = regression */
  delta: number | null;
  direction: 'improved' | 'regressed' | 'unchanged' | 'insufficient_data';
}

export type ComparisonVerdict =
  | 'candidate_better'       // candidate outperforms baseline
  | 'candidate_worse'        // candidate underperforms baseline
  | 'no_significant_diff'    // no meaningful difference
  | 'insufficient_evidence'; // not enough data to compare

// ── Promotion eligibility rules ─────────────────────────────────────

export interface PromotionEligibilityRules {
  /** Minimum closed outcomes under candidate for valid comparison */
  minCandidateOutcomes: number;
  /** Minimum closed outcomes under baseline for valid comparison */
  minBaselineOutcomes: number;
  /** Maximum churn rate regression allowed (candidate - baseline) */
  maxChurnRegression: number;
  /** Maximum intervention rate regression allowed */
  maxInterventionRegression: number;
  /** Maximum recovery rate regression allowed */
  maxRecoveryRegression: number;
}

export const DEFAULT_PROMOTION_RULES: PromotionEligibilityRules = {
  minCandidateOutcomes: 3,
  minBaselineOutcomes: 3,
  maxChurnRegression: 0.1,
  maxInterventionRegression: 0.1,
  maxRecoveryRegression: 0.1,
};

// ── Candidate creation input ────────────────────────────────────────

export interface CreateCandidateInput {
  calibrationReportId: string;
  /** Which adjustment IDs to apply (subset of report's adjustments) */
  adjustmentIds: string[];
  scope?: string;
  actor: string;
  reason: string;
}
