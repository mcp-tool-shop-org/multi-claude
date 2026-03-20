/**
 * Calibration Law — Lane Fitness Derivation.
 *
 * Computes per-lane fitness from outcomes routed through that lane.
 */

import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { RoutingLane } from '../routing/types.js';
import { ALL_LANES } from '../routing/types.js';
import type { ResolutionTerminal, ResolutionQuality } from '../outcome/types.js';
import type { LaneFitness } from './types.js';

const RESOLUTION_TERMINALS: ResolutionTerminal[] = [
  'approved', 'rejected', 'recovered', 'abandoned', 'expired', 'invalidated', 'superseded',
];

const RESOLUTION_QUALITIES: ResolutionQuality[] = [
  'clean', 'churn_heavy', 'recovery_heavy', 'intervention_assisted', 'policy_blocked',
];

/**
 * Derive fitness for a single lane.
 */
export function deriveLaneFitness(
  outcomeStore: OutcomeStore,
  routingStore: RoutingStore,
  lane: RoutingLane,
  policySetId: string | null = null,
): LaneFitness {
  // Get all outcomes, optionally filtered by policy
  const allOutcomes = outcomeStore.listOutcomes(
    policySetId ? { policySetId } : undefined,
  );

  // Filter to outcomes that were routed through this lane
  const laneOutcomes = allOutcomes.filter(o => {
    const route = routingStore.getActiveRoute(o.queueItemId);
    return route?.lane === lane;
  });

  const closed = laneOutcomes.filter(o => o.status === 'closed');

  const resolutionCounts = Object.fromEntries(
    RESOLUTION_TERMINALS.map(t => [t, 0]),
  ) as Record<ResolutionTerminal, number>;
  const qualityCounts = Object.fromEntries(
    RESOLUTION_QUALITIES.map(q => [q, 0]),
  ) as Record<ResolutionQuality, number>;

  for (const o of closed) {
    if (o.resolutionTerminal) resolutionCounts[o.resolutionTerminal]++;
    if (o.resolutionQuality) qualityCounts[o.resolutionQuality]++;
  }

  const total = closed.length || 1;

  const durations = closed
    .filter(o => o.durationMs !== null)
    .map(o => o.durationMs!);
  const meanLeadTimeMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  let totalClaims = 0, totalDefers = 0, totalReroutes = 0;
  let totalOverflows = 0, totalInterventions = 0;

  for (const o of closed) {
    totalClaims += o.claimCount;
    totalDefers += o.deferCount;
    totalReroutes += o.rerouteCount;
    totalOverflows += o.overflowCount;
    totalInterventions += o.interventionCount;
  }

  return {
    lane,
    policySetId,
    totalOutcomes: laneOutcomes.length,
    closedOutcomes: closed.length,
    resolutionCounts,
    qualityCounts,
    cleanRate: qualityCounts.clean / total,
    churnRate: qualityCounts.churn_heavy / total,
    recoveryRate: qualityCounts.recovery_heavy / total,
    interventionRate: qualityCounts.intervention_assisted / total,
    meanLeadTimeMs,
    totalClaims, totalDefers, totalReroutes, totalOverflows, totalInterventions,
  };
}

/**
 * Derive fitness for all lanes.
 */
export function deriveAllLaneFitness(
  outcomeStore: OutcomeStore,
  routingStore: RoutingStore,
  policySetId: string | null = null,
): LaneFitness[] {
  return ALL_LANES.map(lane =>
    deriveLaneFitness(outcomeStore, routingStore, lane, policySetId),
  );
}
