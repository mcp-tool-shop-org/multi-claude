/**
 * Calibration Law — Policy Fitness Derivation.
 *
 * Computes fitness metrics for a policy version from actual outcomes.
 * Deterministic — same outcomes produce same fitness assessment.
 */

import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { Outcome, ResolutionTerminal, ResolutionQuality } from '../outcome/types.js';
import type { PolicyFitness } from './types.js';

const RESOLUTION_TERMINALS: ResolutionTerminal[] = [
  'approved', 'rejected', 'recovered', 'abandoned', 'expired', 'invalidated', 'superseded',
];

const RESOLUTION_QUALITIES: ResolutionQuality[] = [
  'clean', 'churn_heavy', 'recovery_heavy', 'intervention_assisted', 'policy_blocked',
];

function emptyResolutionCounts(): Record<ResolutionTerminal, number> {
  return Object.fromEntries(RESOLUTION_TERMINALS.map(t => [t, 0])) as Record<ResolutionTerminal, number>;
}

function emptyQualityCounts(): Record<ResolutionQuality, number> {
  return Object.fromEntries(RESOLUTION_QUALITIES.map(q => [q, 0])) as Record<ResolutionQuality, number>;
}

/**
 * Derive fitness metrics for a specific policy version.
 */
export function derivePolicyFitness(
  outcomeStore: OutcomeStore,
  policySetId: string,
  policyVersion: number,
  scope: string = 'global',
): PolicyFitness {
  const outcomes = outcomeStore.listOutcomes({ policySetId });
  const closed = outcomes.filter(o => o.status === 'closed');

  const resolutionCounts = emptyResolutionCounts();
  const qualityCounts = emptyQualityCounts();

  for (const o of closed) {
    if (o.resolutionTerminal) resolutionCounts[o.resolutionTerminal]++;
    if (o.resolutionQuality) qualityCounts[o.resolutionQuality]++;
  }

  const total = closed.length || 1; // avoid div by zero

  // Timing
  const durations = closed
    .filter(o => o.durationMs !== null)
    .map(o => o.durationMs!)
    .sort((a, b) => a - b);

  const meanLeadTimeMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const medianLeadTimeMs = durations.length > 0
    ? durations[Math.floor(durations.length / 2)] ?? null
    : null;

  const p95LeadTimeMs = durations.length > 0
    ? durations[Math.floor(durations.length * 0.95)] ?? null
    : null;

  // Aggregate counters
  const aggregated = aggregateCounters(closed);

  return {
    policySetId,
    policyVersion,
    scope,
    totalOutcomes: outcomes.length,
    closedOutcomes: closed.length,
    openOutcomes: outcomes.length - closed.length,
    resolutionCounts,
    qualityCounts,
    cleanRate: qualityCounts.clean / total,
    churnRate: qualityCounts.churn_heavy / total,
    recoveryRate: qualityCounts.recovery_heavy / total,
    interventionRate: qualityCounts.intervention_assisted / total,
    meanLeadTimeMs,
    medianLeadTimeMs,
    p95LeadTimeMs,
    ...aggregated,
    outcomesWithPolicyChange: closed.filter(o => o.policyChangedDuringLifecycle).length,
  };
}

function aggregateCounters(outcomes: Outcome[]) {
  let totalClaims = 0, totalDefers = 0, totalReroutes = 0, totalEscalations = 0;
  let totalOverflows = 0, totalInterventions = 0, totalRecoveryCycles = 0, totalClaimChurn = 0;

  for (const o of outcomes) {
    totalClaims += o.claimCount;
    totalDefers += o.deferCount;
    totalReroutes += o.rerouteCount;
    totalEscalations += o.escalationCount;
    totalOverflows += o.overflowCount;
    totalInterventions += o.interventionCount;
    totalRecoveryCycles += o.recoveryCycleCount;
    totalClaimChurn += o.claimChurnCount;
  }

  return {
    totalClaims, totalDefers, totalReroutes, totalEscalations,
    totalOverflows, totalInterventions, totalRecoveryCycles, totalClaimChurn,
  };
}
