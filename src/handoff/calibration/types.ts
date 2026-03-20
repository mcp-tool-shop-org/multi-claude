/**
 * Calibration Law — Phase 11 canonical types.
 *
 * Calibration connects policy truth, intervention truth, and outcome
 * truth into a lawful retrospective layer that evaluates whether
 * the control plane's rules are actually working.
 *
 * Law: calibration is evidence-driven, deterministic, and never
 * auto-activates changes. Every proposal binds to exact outcomes.
 */

import type { RoutingLane } from '../routing/types.js';
import type { ResolutionTerminal, ResolutionQuality } from '../outcome/types.js';

// ── Policy fitness ───────────────────────────────────────────────────

export interface PolicyFitness {
  policySetId: string;
  policyVersion: number;
  scope: string;

  /** Total outcomes under this policy */
  totalOutcomes: number;
  closedOutcomes: number;
  openOutcomes: number;

  /** Resolution distribution */
  resolutionCounts: Record<ResolutionTerminal, number>;
  qualityCounts: Record<ResolutionQuality, number>;

  /** Rates (0–1) */
  cleanRate: number;
  churnRate: number;
  recoveryRate: number;
  interventionRate: number;

  /** Timing */
  meanLeadTimeMs: number | null;
  medianLeadTimeMs: number | null;
  p95LeadTimeMs: number | null;

  /** Aggregate churn */
  totalClaims: number;
  totalDefers: number;
  totalReroutes: number;
  totalEscalations: number;
  totalOverflows: number;
  totalInterventions: number;
  totalRecoveryCycles: number;
  totalClaimChurn: number;

  /** Policy change exposure */
  outcomesWithPolicyChange: number;
}

// ── Lane fitness ─────────────────────────────────────────────────────

export interface LaneFitness {
  lane: RoutingLane;
  policySetId: string | null;

  totalOutcomes: number;
  closedOutcomes: number;

  resolutionCounts: Record<ResolutionTerminal, number>;
  qualityCounts: Record<ResolutionQuality, number>;

  cleanRate: number;
  churnRate: number;
  recoveryRate: number;
  interventionRate: number;

  meanLeadTimeMs: number | null;

  totalClaims: number;
  totalDefers: number;
  totalReroutes: number;
  totalOverflows: number;
  totalInterventions: number;
}

// ── Pain signals ─────────────────────────────────────────────────────

export type PainCode =
  | 'chronic_churn'               // churn rate exceeds threshold
  | 'excessive_recovery'          // recovery rate exceeds threshold
  | 'intervention_dependency'     // intervention rate exceeds threshold
  | 'overflow_pressure'           // overflow frequency too high
  | 'slow_resolution'             // lead times too long
  | 'cap_too_tight'               // lane at cap with overflow
  | 'cap_too_loose'               // lane consistently under-utilized
  | 'starvation_pattern'          // repeated starvation in lane
  | 'routing_churn'               // excessive reroutes
  | 'claim_churn'                 // excessive claim expiry/release
  | 'recovery_storm'              // recovery cycles too frequent
  | 'threshold_drift';            // thresholds not matching actual patterns

export type PainSeverity = 'low' | 'medium' | 'high';

export interface PainSignal {
  code: PainCode;
  severity: PainSeverity;
  lane: RoutingLane | null;
  description: string;
  evidence: PainEvidence;
}

export interface PainEvidence {
  metric: string;
  observedValue: number;
  thresholdValue: number;
  outcomeIds: string[];
  sampleSize: number;
}

// ── Policy adjustment proposals ──────────────────────────────────────

export type AdjustmentKind =
  | 'increase_cap'
  | 'decrease_cap'
  | 'increase_starvation_threshold'
  | 'decrease_starvation_threshold'
  | 'increase_overflow_threshold'
  | 'decrease_overflow_threshold'
  | 'increase_breach_threshold'
  | 'decrease_breach_threshold'
  | 'adjust_recovery_throttle'
  | 'adjust_lease_duration'
  | 'adjust_routing_default';

export interface PolicyAdjustment {
  adjustmentId: string;
  kind: AdjustmentKind;
  lane: RoutingLane | null;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  painCodes: PainCode[];
  confidence: 'low' | 'medium' | 'high';
  evidence: AdjustmentEvidence;
}

export interface AdjustmentEvidence {
  outcomeCount: number;
  affectedOutcomeIds: string[];
  policySetId: string;
  policyVersion: number;
  painSignals: PainSignal[];
}

// ── Calibration report ───────────────────────────────────────────────

export interface CalibrationReport {
  reportId: string;
  policySetId: string | null;
  policyVersion: number | null;
  scope: string;
  createdAt: string;

  /** What was analyzed */
  outcomeWindow: {
    from: string | null;
    to: string | null;
    totalOutcomes: number;
    closedOutcomes: number;
  };

  /** Fitness assessment */
  policyFitness: PolicyFitness | null;
  laneFitness: LaneFitness[];

  /** Detected pain */
  painSignals: PainSignal[];

  /** Proposed changes */
  adjustments: PolicyAdjustment[];

  /** Summary */
  summary: string;
}

// ── Calibration thresholds (configurable) ────────────────────────────

export interface CalibrationThresholds {
  /** Churn rate above which to flag */
  churnRateThreshold: number;
  /** Recovery rate above which to flag */
  recoveryRateThreshold: number;
  /** Intervention rate above which to flag */
  interventionRateThreshold: number;
  /** Mean lead time (ms) above which to flag */
  slowResolutionMs: number;
  /** Min outcomes required for meaningful calibration */
  minOutcomesForCalibration: number;
  /** Overflow count per lane above which to flag cap issues */
  overflowPressureThreshold: number;
  /** Reroute count per outcome above which to flag routing churn */
  routingChurnThreshold: number;
  /** Claim churn count per outcome above which to flag */
  claimChurnThreshold: number;
}

export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  churnRateThreshold: 0.3,
  recoveryRateThreshold: 0.2,
  interventionRateThreshold: 0.15,
  slowResolutionMs: 2 * 60 * 60 * 1000,   // 2 hours
  minOutcomesForCalibration: 3,
  overflowPressureThreshold: 3,
  routingChurnThreshold: 2,
  claimChurnThreshold: 2,
};
