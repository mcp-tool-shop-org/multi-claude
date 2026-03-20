/**
 * Promotion Law — Actions.
 *
 * Core promotion pipeline:
 *   1. createCandidate — build candidate policy from calibration adjustments
 *   2. validateCandidate — validate candidate before trial
 *   3. startTrial — activate candidate in scoped trial
 *   4. stopTrial — end trial explicitly
 *   5. compareTrialOutcomes — compare candidate vs baseline
 *   6. promoteCandidate — apply candidate as new active policy
 *   7. rollbackCandidate — reject candidate, restore baseline
 *
 * Every action is explicit, auditable, and evidence-bound.
 */

import type { CalibrationStore } from '../calibration/calibration-store.js';
import type { PolicyStore } from '../policy/policy-store.js';
import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { PromotionStore } from './promotion-store.js';
import { resolveActivePolicy, createPolicySet, activatePolicy, validatePolicy } from '../policy/policy-actions.js';
import type { PolicyContent } from '../policy/types.js';
import type { PolicyAdjustment } from '../calibration/types.js';
import type {
  PromotionRecord,
  PromotionStatus,
  TrialScope,
  TrialComparison,
  ComparisonMetrics,
  ComparisonDiff,
  ComparisonVerdict,
  PromotionEligibilityRules,
  CreateCandidateInput,
} from './types.js';
import { DEFAULT_PROMOTION_RULES, TERMINAL_PROMOTION_STATUSES } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Result types ────────────────────────────────────────────────────

export interface CreateCandidateResult {
  ok: true;
  promotion: PromotionRecord;
  candidatePolicySetId: string;
}

export interface CreateCandidateError {
  ok: false;
  error: string;
  code: 'report_not_found' | 'no_adjustments' | 'no_baseline' | 'policy_create_failed';
}

export interface ValidateCandidateResult {
  ok: true;
  promotion: PromotionRecord;
}

export interface ValidateCandidateError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'validation_failed';
}

export interface StartTrialResult {
  ok: true;
  promotion: PromotionRecord;
}

export interface StartTrialError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'active_trial_exists';
}

export interface StopTrialResult {
  ok: true;
  promotion: PromotionRecord;
}

export interface StopTrialError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status';
}

export interface CompareResult {
  ok: true;
  comparison: TrialComparison;
}

export interface CompareError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'insufficient_data';
}

export interface PromoteResult {
  ok: true;
  promotion: PromotionRecord;
}

export interface PromoteError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'no_comparison' | 'not_eligible' | 'activate_failed';
}

export interface RollbackResult {
  ok: true;
  promotion: PromotionRecord;
}

export interface RollbackError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status';
}

// ── 1. Create candidate ─────────────────────────────────────────────

/**
 * Create a candidate policy from calibration adjustment proposals.
 * Applies selected adjustments to the current active policy content.
 */
export function createCandidate(
  promotionStore: PromotionStore,
  calibrationStore: CalibrationStore,
  policyStore: PolicyStore,
  input: CreateCandidateInput,
): CreateCandidateResult | CreateCandidateError {
  const scope = input.scope ?? 'global';

  // Resolve calibration report
  const report = calibrationStore.getReport(input.calibrationReportId);
  if (!report) {
    return { ok: false, error: `Calibration report '${input.calibrationReportId}' not found`, code: 'report_not_found' };
  }

  // Find adjustments to apply
  const selectedAdjustments = report.adjustments.filter(
    a => input.adjustmentIds.includes(a.adjustmentId),
  );
  if (selectedAdjustments.length === 0) {
    return { ok: false, error: 'No matching adjustments found in calibration report', code: 'no_adjustments' };
  }

  // Resolve baseline policy
  const baseline = resolveActivePolicy(policyStore, scope);
  if (!baseline.policySetId) {
    return { ok: false, error: 'No active baseline policy to compare against', code: 'no_baseline' };
  }

  // Apply adjustments to baseline content
  const candidateContent = applyAdjustments(baseline.content, selectedAdjustments);

  // Create candidate policy set
  const createResult = createPolicySet(policyStore, {
    content: candidateContent,
    scope,
    reason: `Candidate from calibration ${input.calibrationReportId}: ${input.reason}`,
    actor: input.actor,
  });

  if (!createResult.ok) {
    return { ok: false, error: `Failed to create candidate policy: ${createResult.error}`, code: 'policy_create_failed' };
  }

  const now = nowISO();
  const promotion: PromotionRecord = {
    promotionId: generateId('promo'),
    proposalIds: selectedAdjustments.map(a => a.adjustmentId),
    sourceCalibrationReportId: input.calibrationReportId,
    candidatePolicySetId: createResult.policySet.policySetId,
    baselinePolicySetId: baseline.policySetId,
    scope,
    status: 'draft',
    trialScope: null,
    createdAt: now,
    trialStartedAt: null,
    trialEndedAt: null,
    decisionAt: null,
    createdBy: input.actor,
  };

  promotionStore.insertPromotion(promotion);
  promotionStore.insertEvent({
    promotionId: promotion.promotionId,
    kind: 'created',
    fromStatus: null,
    toStatus: 'draft',
    reason: input.reason,
    actor: input.actor,
    detail: JSON.stringify({ adjustmentIds: input.adjustmentIds }),
    createdAt: now,
  });

  return { ok: true, promotion, candidatePolicySetId: createResult.policySet.policySetId };
}

// ── 2. Validate candidate ───────────────────────────────────────────

/**
 * Validate candidate policy content before trial.
 */
export function validateCandidate(
  promotionStore: PromotionStore,
  policyStore: PolicyStore,
  promotionId: string,
  actor: string,
): ValidateCandidateResult | ValidateCandidateError {
  const promo = promotionStore.getPromotion(promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${promotionId}' not found`, code: 'not_found' };
  }
  if (promo.status !== 'draft') {
    return { ok: false, error: `Cannot validate promotion in status '${promo.status}'`, code: 'invalid_status' };
  }

  const ps = policyStore.getPolicySet(promo.candidatePolicySetId);
  if (!ps) {
    return { ok: false, error: 'Candidate policy set not found', code: 'not_found' };
  }

  const validation = validatePolicy(ps.content);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Candidate validation failed: ${validation.errors.join('; ')}`,
      code: 'validation_failed',
    };
  }

  const now = nowISO();
  promotionStore.updateStatus(promotionId, { status: 'ready_for_trial' });
  promotionStore.insertEvent({
    promotionId,
    kind: 'validated',
    fromStatus: 'draft',
    toStatus: 'ready_for_trial',
    reason: 'Candidate policy passed validation',
    actor,
    detail: null,
    createdAt: now,
  });

  return { ok: true, promotion: { ...promo, status: 'ready_for_trial' } };
}

// ── 3. Start trial ──────────────────────────────────────────────────

/**
 * Start a scoped trial of the candidate policy.
 */
export function startTrial(
  promotionStore: PromotionStore,
  policyStore: PolicyStore,
  input: {
    promotionId: string;
    trialScope: TrialScope;
    actor: string;
    reason: string;
  },
): StartTrialResult | StartTrialError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }
  if (promo.status !== 'ready_for_trial') {
    return { ok: false, error: `Cannot start trial in status '${promo.status}'`, code: 'invalid_status' };
  }

  // Check for conflicting active trials in same scope
  const activeTrials = promotionStore.getActiveTrials(promo.scope);
  if (activeTrials.length > 0) {
    return {
      ok: false,
      error: `Active trial already exists for scope '${promo.scope}': ${activeTrials[0]!.promotionId}`,
      code: 'active_trial_exists',
    };
  }

  // Activate candidate policy for trial
  const activateResult = activatePolicy(policyStore, {
    policySetId: promo.candidatePolicySetId,
    actor: input.actor,
    reason: `Trial activation for promotion ${promo.promotionId}`,
  });

  if (!activateResult.ok) {
    return { ok: false, error: `Failed to activate candidate: ${activateResult.error}`, code: 'invalid_status' };
  }

  const now = nowISO();
  promotionStore.updateStatus(input.promotionId, {
    status: 'trial_active',
    trialScope: input.trialScope,
    trialStartedAt: now,
  });
  promotionStore.insertEvent({
    promotionId: input.promotionId,
    kind: 'trial_started',
    fromStatus: 'ready_for_trial',
    toStatus: 'trial_active',
    reason: input.reason,
    actor: input.actor,
    detail: JSON.stringify(input.trialScope),
    createdAt: now,
  });

  return {
    ok: true,
    promotion: {
      ...promo,
      status: 'trial_active',
      trialScope: input.trialScope,
      trialStartedAt: now,
    },
  };
}

// ── 4. Stop trial ───────────────────────────────────────────────────

/**
 * Stop a running trial explicitly.
 */
export function stopTrial(
  promotionStore: PromotionStore,
  input: {
    promotionId: string;
    actor: string;
    reason: string;
  },
): StopTrialResult | StopTrialError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }
  if (promo.status !== 'trial_active') {
    return { ok: false, error: `Cannot stop trial in status '${promo.status}'`, code: 'invalid_status' };
  }

  const now = nowISO();
  promotionStore.updateStatus(input.promotionId, {
    status: 'trial_completed',
    trialEndedAt: now,
  });
  promotionStore.insertEvent({
    promotionId: input.promotionId,
    kind: 'trial_stopped',
    fromStatus: 'trial_active',
    toStatus: 'trial_completed',
    reason: input.reason,
    actor: input.actor,
    detail: null,
    createdAt: now,
  });

  return {
    ok: true,
    promotion: { ...promo, status: 'trial_completed', trialEndedAt: now },
  };
}

// ── 5. Compare trial outcomes ───────────────────────────────────────

/**
 * Compare candidate vs baseline using actual outcomes.
 */
export function compareTrialOutcomes(
  promotionStore: PromotionStore,
  outcomeStore: OutcomeStore,
  input: {
    promotionId: string;
    rules?: PromotionEligibilityRules;
  },
): CompareResult | CompareError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }
  if (promo.status !== 'trial_completed' && promo.status !== 'trial_active') {
    return { ok: false, error: `Cannot compare in status '${promo.status}'`, code: 'invalid_status' };
  }

  const rules = input.rules ?? DEFAULT_PROMOTION_RULES;

  // Gather candidate outcomes
  const candidateOutcomes = outcomeStore.listOutcomes({
    policySetId: promo.candidatePolicySetId,
    status: 'closed',
  });

  // Gather baseline outcomes
  const baselineOutcomes = outcomeStore.listOutcomes({
    policySetId: promo.baselinePolicySetId,
    status: 'closed',
  });

  const candidateMetrics = computeMetrics(candidateOutcomes);
  const baselineMetrics = computeMetrics(baselineOutcomes);

  // Check minimum evidence
  if (candidateMetrics.closedOutcomes < rules.minCandidateOutcomes ||
      baselineMetrics.closedOutcomes < rules.minBaselineOutcomes) {
    const comparison = buildComparison(
      promo, candidateMetrics, baselineMetrics,
      'insufficient_evidence',
      `Insufficient data: candidate ${candidateMetrics.closedOutcomes} (need ${rules.minCandidateOutcomes}), baseline ${baselineMetrics.closedOutcomes} (need ${rules.minBaselineOutcomes})`,
    );
    promotionStore.insertComparison(comparison);
    recordComparisonEvent(promotionStore, promo, comparison);
    return { ok: true, comparison };
  }

  // Compute diffs
  const diffs = computeDiffs(candidateMetrics, baselineMetrics);

  // Determine verdict
  const { verdict, reason } = determineVerdict(candidateMetrics, baselineMetrics, diffs, rules);

  const comparison = buildComparison(
    promo, candidateMetrics, baselineMetrics, verdict, reason,
  );
  promotionStore.insertComparison(comparison);
  recordComparisonEvent(promotionStore, promo, comparison);

  // Update status if promotion eligible
  if (verdict === 'candidate_better' || verdict === 'no_significant_diff') {
    const now = nowISO();
    promotionStore.updateStatus(promo.promotionId, { status: 'promotion_eligible' });
    promotionStore.insertEvent({
      promotionId: promo.promotionId,
      kind: 'promotion_eligible',
      fromStatus: promo.status,
      toStatus: 'promotion_eligible',
      reason: `Comparison verdict: ${verdict}`,
      actor: 'system',
      detail: null,
      createdAt: now,
    });
  }

  return { ok: true, comparison };
}

// ── 6. Promote candidate ────────────────────────────────────────────

/**
 * Promote candidate policy — make it the active policy.
 */
export function promoteCandidate(
  promotionStore: PromotionStore,
  policyStore: PolicyStore,
  input: {
    promotionId: string;
    actor: string;
    reason: string;
  },
): PromoteResult | PromoteError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }
  if (promo.status !== 'promotion_eligible') {
    return { ok: false, error: `Cannot promote in status '${promo.status}'`, code: 'invalid_status' };
  }

  // Must have comparison evidence
  const comparison = promotionStore.getLatestComparison(promo.promotionId);
  if (!comparison) {
    return { ok: false, error: 'No comparison evidence for promotion', code: 'no_comparison' };
  }
  if (comparison.verdict === 'candidate_worse' || comparison.verdict === 'insufficient_evidence') {
    return { ok: false, error: `Cannot promote with verdict '${comparison.verdict}'`, code: 'not_eligible' };
  }

  // Activate candidate policy (may already be active from trial)
  const active = resolveActivePolicy(policyStore, promo.scope);
  if (active.policySetId !== promo.candidatePolicySetId) {
    const activateResult = activatePolicy(policyStore, {
      policySetId: promo.candidatePolicySetId,
      actor: input.actor,
      reason: `Promotion ${promo.promotionId}: ${input.reason}`,
    });
    if (!activateResult.ok) {
      return { ok: false, error: `Failed to activate: ${activateResult.error}`, code: 'activate_failed' };
    }
  }

  const now = nowISO();
  promotionStore.updateStatus(promo.promotionId, {
    status: 'promoted',
    decisionAt: now,
  });
  promotionStore.insertEvent({
    promotionId: promo.promotionId,
    kind: 'promoted',
    fromStatus: 'promotion_eligible',
    toStatus: 'promoted',
    reason: input.reason,
    actor: input.actor,
    detail: JSON.stringify({ comparisonId: comparison.comparisonId }),
    createdAt: now,
  });

  return { ok: true, promotion: { ...promo, status: 'promoted', decisionAt: now } };
}

// ── 7. Rollback candidate ───────────────────────────────────────────

/**
 * Rollback candidate — restore baseline policy and reject candidate.
 */
export function rollbackCandidate(
  promotionStore: PromotionStore,
  policyStore: PolicyStore,
  input: {
    promotionId: string;
    actor: string;
    reason: string;
  },
): RollbackResult | RollbackError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }

  const rollbackableStatuses: PromotionStatus[] = [
    'trial_active', 'trial_completed', 'promotion_eligible',
  ];
  if (!rollbackableStatuses.includes(promo.status)) {
    return { ok: false, error: `Cannot rollback in status '${promo.status}'`, code: 'invalid_status' };
  }

  // Re-activate baseline policy
  const active = resolveActivePolicy(policyStore, promo.scope);
  if (active.policySetId !== promo.baselinePolicySetId) {
    // Baseline may have been superseded by candidate during trial — re-activate it
    activatePolicy(policyStore, {
      policySetId: promo.baselinePolicySetId,
      actor: input.actor,
      reason: `Rollback promotion ${promo.promotionId}: ${input.reason}`,
    });
  }

  const now = nowISO();
  promotionStore.updateStatus(promo.promotionId, {
    status: 'rolled_back',
    trialEndedAt: promo.trialEndedAt ?? now,
    decisionAt: now,
  });
  promotionStore.insertEvent({
    promotionId: promo.promotionId,
    kind: 'rolled_back',
    fromStatus: promo.status,
    toStatus: 'rolled_back',
    reason: input.reason,
    actor: input.actor,
    detail: null,
    createdAt: now,
  });

  return { ok: true, promotion: { ...promo, status: 'rolled_back', decisionAt: now } };
}

// ── 8. Reject candidate ─────────────────────────────────────────────

/**
 * Reject candidate without trial or after comparison.
 */
export function rejectCandidate(
  promotionStore: PromotionStore,
  input: {
    promotionId: string;
    actor: string;
    reason: string;
  },
): RollbackResult | RollbackError {
  const promo = promotionStore.getPromotion(input.promotionId);
  if (!promo) {
    return { ok: false, error: `Promotion '${input.promotionId}' not found`, code: 'not_found' };
  }

  if (TERMINAL_PROMOTION_STATUSES.includes(promo.status)) {
    return { ok: false, error: `Cannot reject in terminal status '${promo.status}'`, code: 'invalid_status' };
  }

  const now = nowISO();
  promotionStore.updateStatus(promo.promotionId, {
    status: 'rejected',
    decisionAt: now,
  });
  promotionStore.insertEvent({
    promotionId: promo.promotionId,
    kind: 'rejected',
    fromStatus: promo.status,
    toStatus: 'rejected',
    reason: input.reason,
    actor: input.actor,
    detail: null,
    createdAt: now,
  });

  return { ok: true, promotion: { ...promo, status: 'rejected', decisionAt: now } };
}

// ── Internal helpers ────────────────────────────────────────────────

function applyAdjustments(
  content: PolicyContent,
  adjustments: PolicyAdjustment[],
): PolicyContent {
  // Deep clone
  const result = JSON.parse(JSON.stringify(content)) as PolicyContent;

  for (const adj of adjustments) {
    applyOneAdjustment(result, adj);
  }

  return result;
}

function applyOneAdjustment(content: PolicyContent, adj: PolicyAdjustment): void {
  if (adj.proposedValue === null || adj.proposedValue === undefined) return;

  switch (adj.kind) {
    case 'increase_cap':
    case 'decrease_cap':
      if (adj.lane) content.laneCaps[adj.lane] = adj.proposedValue as number;
      break;
    case 'increase_starvation_threshold':
    case 'decrease_starvation_threshold':
      if (adj.lane) content.starvationThresholdMs[adj.lane] = adj.proposedValue as number;
      break;
    case 'increase_overflow_threshold':
    case 'decrease_overflow_threshold':
      if (adj.lane) content.overflowThreshold[adj.lane] = adj.proposedValue as number;
      break;
    case 'adjust_recovery_throttle':
      content.recoveryThrottle = adj.proposedValue as number;
      break;
    case 'adjust_lease_duration':
      content.leaseDurationMs = adj.proposedValue as number;
      break;
    case 'increase_breach_threshold':
    case 'decrease_breach_threshold': {
      // Parse field like 'breachThresholds.saturationChecks'
      const parts = adj.field.split('.');
      if (parts.length === 2 && parts[0] === 'breachThresholds') {
        const key = parts[1] as keyof typeof content.breachThresholds;
        if (key in content.breachThresholds) {
          content.breachThresholds[key] = adj.proposedValue as number;
        }
      }
      break;
    }
    case 'adjust_routing_default':
      // proposedValue=null means human must decide — skip
      if (adj.lane && adj.proposedValue !== null) {
        content.routingDefaults[adj.lane] = adj.proposedValue as string | null;
      }
      break;
  }
}

interface OutcomeLike {
  status: string;
  resolutionQuality: string | null;
  durationMs: number | null;
  overflowCount: number;
  claimCount: number;
}

function computeMetrics(outcomes: OutcomeLike[]): ComparisonMetrics {
  const closed = outcomes.filter(o => o.status === 'closed');
  const total = closed.length || 1;

  let cleanCount = 0, churnCount = 0, recoveryCount = 0, interventionCount = 0;
  let overflowSum = 0, starvationSum = 0;
  const durations: number[] = [];

  for (const o of closed) {
    if (o.resolutionQuality === 'clean') cleanCount++;
    else if (o.resolutionQuality === 'churn_heavy') churnCount++;
    else if (o.resolutionQuality === 'recovery_heavy') recoveryCount++;
    else if (o.resolutionQuality === 'intervention_assisted') interventionCount++;
    overflowSum += o.overflowCount;
    if (o.durationMs !== null) durations.push(o.durationMs);
  }

  const meanLeadTimeMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  return {
    totalOutcomes: outcomes.length,
    closedOutcomes: closed.length,
    cleanRate: cleanCount / total,
    churnRate: churnCount / total,
    recoveryRate: recoveryCount / total,
    interventionRate: interventionCount / total,
    overflowCount: overflowSum,
    starvationCount: starvationSum,
    meanLeadTimeMs,
  };
}

function computeDiffs(
  candidate: ComparisonMetrics,
  baseline: ComparisonMetrics,
): ComparisonDiff[] {
  const diffs: ComparisonDiff[] = [];

  const metrics: Array<{
    name: string;
    cVal: number | null;
    bVal: number | null;
    lowerIsBetter: boolean;
  }> = [
    { name: 'cleanRate', cVal: candidate.cleanRate, bVal: baseline.cleanRate, lowerIsBetter: false },
    { name: 'churnRate', cVal: candidate.churnRate, bVal: baseline.churnRate, lowerIsBetter: true },
    { name: 'recoveryRate', cVal: candidate.recoveryRate, bVal: baseline.recoveryRate, lowerIsBetter: true },
    { name: 'interventionRate', cVal: candidate.interventionRate, bVal: baseline.interventionRate, lowerIsBetter: true },
    { name: 'overflowCount', cVal: candidate.overflowCount, bVal: baseline.overflowCount, lowerIsBetter: true },
    { name: 'meanLeadTimeMs', cVal: candidate.meanLeadTimeMs, bVal: baseline.meanLeadTimeMs, lowerIsBetter: true },
  ];

  for (const m of metrics) {
    if (m.cVal === null || m.bVal === null) {
      diffs.push({
        metric: m.name,
        candidateValue: m.cVal,
        baselineValue: m.bVal,
        delta: null,
        direction: 'insufficient_data',
      });
      continue;
    }

    const delta = m.cVal - m.bVal;
    const threshold = 0.01; // 1% tolerance
    let direction: ComparisonDiff['direction'];

    if (Math.abs(delta) < threshold) {
      direction = 'unchanged';
    } else if (m.lowerIsBetter) {
      direction = delta < 0 ? 'improved' : 'regressed';
    } else {
      direction = delta > 0 ? 'improved' : 'regressed';
    }

    diffs.push({
      metric: m.name,
      candidateValue: m.cVal,
      baselineValue: m.bVal,
      delta,
      direction,
    });
  }

  return diffs;
}

function determineVerdict(
  _candidate: ComparisonMetrics,
  _baseline: ComparisonMetrics,
  diffs: ComparisonDiff[],
  rules: PromotionEligibilityRules,
): { verdict: ComparisonVerdict; reason: string } {
  // Check for regressions exceeding limits
  const churnDiff = diffs.find(d => d.metric === 'churnRate');
  if (churnDiff?.delta !== null && churnDiff?.delta !== undefined && churnDiff.delta > rules.maxChurnRegression) {
    return {
      verdict: 'candidate_worse',
      reason: `Churn rate regression ${(churnDiff.delta * 100).toFixed(0)}% exceeds max allowed ${(rules.maxChurnRegression * 100).toFixed(0)}%`,
    };
  }

  const interventionDiff = diffs.find(d => d.metric === 'interventionRate');
  if (interventionDiff?.delta !== null && interventionDiff?.delta !== undefined && interventionDiff.delta > rules.maxInterventionRegression) {
    return {
      verdict: 'candidate_worse',
      reason: `Intervention rate regression ${(interventionDiff.delta * 100).toFixed(0)}% exceeds max allowed ${(rules.maxInterventionRegression * 100).toFixed(0)}%`,
    };
  }

  const recoveryDiff = diffs.find(d => d.metric === 'recoveryRate');
  if (recoveryDiff?.delta !== null && recoveryDiff?.delta !== undefined && recoveryDiff.delta > rules.maxRecoveryRegression) {
    return {
      verdict: 'candidate_worse',
      reason: `Recovery rate regression ${(recoveryDiff.delta * 100).toFixed(0)}% exceeds max allowed ${(rules.maxRecoveryRegression * 100).toFixed(0)}%`,
    };
  }

  // Check for improvements
  const improvements = diffs.filter(d => d.direction === 'improved').length;
  const regressions = diffs.filter(d => d.direction === 'regressed').length;

  if (improvements > regressions) {
    return {
      verdict: 'candidate_better',
      reason: `${improvements} metrics improved, ${regressions} regressed (within acceptable bounds)`,
    };
  }

  if (regressions === 0) {
    return {
      verdict: 'no_significant_diff',
      reason: 'No significant difference between candidate and baseline',
    };
  }

  return {
    verdict: 'candidate_worse',
    reason: `${regressions} metrics regressed, ${improvements} improved`,
  };
}

function buildComparison(
  promo: PromotionRecord,
  candidateMetrics: ComparisonMetrics,
  baselineMetrics: ComparisonMetrics,
  verdict: ComparisonVerdict,
  verdictReason: string,
): TrialComparison {
  return {
    comparisonId: generateId('cmp'),
    promotionId: promo.promotionId,
    candidatePolicySetId: promo.candidatePolicySetId,
    baselinePolicySetId: promo.baselinePolicySetId,
    windowFrom: promo.trialStartedAt,
    windowTo: promo.trialEndedAt,
    candidateMetrics,
    baselineMetrics,
    diffs: verdict === 'insufficient_evidence'
      ? []
      : computeDiffs(candidateMetrics, baselineMetrics),
    verdict,
    verdictReason,
    createdAt: nowISO(),
  };
}

function recordComparisonEvent(
  promotionStore: PromotionStore,
  promo: PromotionRecord,
  comparison: TrialComparison,
): void {
  promotionStore.insertEvent({
    promotionId: promo.promotionId,
    kind: 'comparison_run',
    fromStatus: promo.status,
    toStatus: promo.status,
    reason: `Comparison verdict: ${comparison.verdict}`,
    actor: 'system',
    detail: JSON.stringify({
      comparisonId: comparison.comparisonId,
      verdict: comparison.verdict,
    }),
    createdAt: nowISO(),
  });
}
