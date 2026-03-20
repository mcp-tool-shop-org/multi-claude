/**
 * Calibration Law — Pain Detection.
 *
 * Deterministic detection of policy pain patterns from fitness data.
 * Every signal binds to specific metrics and outcome evidence.
 */

import type { RoutingLane } from '../routing/types.js';
import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type {
  PolicyFitness,
  LaneFitness,
  PainSignal,
  PainSeverity,
  CalibrationThresholds,
} from './types.js';
import { DEFAULT_CALIBRATION_THRESHOLDS } from './types.js';

/**
 * Detect pain signals from policy fitness and lane fitness data.
 */
export function detectPolicyPain(
  policyFitness: PolicyFitness | null,
  laneFitness: LaneFitness[],
  outcomeStore: OutcomeStore,
  routingStore: RoutingStore,
  thresholds: CalibrationThresholds = DEFAULT_CALIBRATION_THRESHOLDS,
): PainSignal[] {
  const signals: PainSignal[] = [];

  // Policy-level pain
  if (policyFitness && policyFitness.closedOutcomes >= thresholds.minOutcomesForCalibration) {
    // Chronic churn
    if (policyFitness.churnRate > thresholds.churnRateThreshold) {
      signals.push({
        code: 'chronic_churn',
        severity: severityFromRate(policyFitness.churnRate, thresholds.churnRateThreshold),
        lane: null,
        description: `Churn rate ${pct(policyFitness.churnRate)} exceeds threshold ${pct(thresholds.churnRateThreshold)}`,
        evidence: {
          metric: 'churnRate',
          observedValue: policyFitness.churnRate,
          thresholdValue: thresholds.churnRateThreshold,
          outcomeIds: getChurnOutcomeIds(outcomeStore, policyFitness.policySetId),
          sampleSize: policyFitness.closedOutcomes,
        },
      });
    }

    // Excessive recovery
    if (policyFitness.recoveryRate > thresholds.recoveryRateThreshold) {
      signals.push({
        code: 'excessive_recovery',
        severity: severityFromRate(policyFitness.recoveryRate, thresholds.recoveryRateThreshold),
        lane: null,
        description: `Recovery rate ${pct(policyFitness.recoveryRate)} exceeds threshold ${pct(thresholds.recoveryRateThreshold)}`,
        evidence: {
          metric: 'recoveryRate',
          observedValue: policyFitness.recoveryRate,
          thresholdValue: thresholds.recoveryRateThreshold,
          outcomeIds: getRecoveryOutcomeIds(outcomeStore, policyFitness.policySetId),
          sampleSize: policyFitness.closedOutcomes,
        },
      });
    }

    // Intervention dependency
    if (policyFitness.interventionRate > thresholds.interventionRateThreshold) {
      signals.push({
        code: 'intervention_dependency',
        severity: severityFromRate(policyFitness.interventionRate, thresholds.interventionRateThreshold),
        lane: null,
        description: `Intervention rate ${pct(policyFitness.interventionRate)} exceeds threshold ${pct(thresholds.interventionRateThreshold)}`,
        evidence: {
          metric: 'interventionRate',
          observedValue: policyFitness.interventionRate,
          thresholdValue: thresholds.interventionRateThreshold,
          outcomeIds: getInterventionOutcomeIds(outcomeStore, policyFitness.policySetId),
          sampleSize: policyFitness.closedOutcomes,
        },
      });
    }

    // Slow resolution
    if (policyFitness.meanLeadTimeMs !== null && policyFitness.meanLeadTimeMs > thresholds.slowResolutionMs) {
      signals.push({
        code: 'slow_resolution',
        severity: severityFromRate(policyFitness.meanLeadTimeMs / thresholds.slowResolutionMs, 1),
        lane: null,
        description: `Mean lead time ${msToMin(policyFitness.meanLeadTimeMs)}m exceeds threshold ${msToMin(thresholds.slowResolutionMs)}m`,
        evidence: {
          metric: 'meanLeadTimeMs',
          observedValue: policyFitness.meanLeadTimeMs,
          thresholdValue: thresholds.slowResolutionMs,
          outcomeIds: [],
          sampleSize: policyFitness.closedOutcomes,
        },
      });
    }
  }

  // Lane-level pain
  for (const lf of laneFitness) {
    if (lf.closedOutcomes < thresholds.minOutcomesForCalibration) continue;

    // Overflow pressure per lane
    if (lf.totalOverflows > lf.closedOutcomes * thresholds.overflowPressureThreshold / lf.closedOutcomes) {
      const avgOverflow = lf.totalOverflows / lf.closedOutcomes;
      if (avgOverflow >= thresholds.overflowPressureThreshold) {
        signals.push({
          code: 'cap_too_tight',
          severity: avgOverflow >= thresholds.overflowPressureThreshold * 2 ? 'high' : 'medium',
          lane: lf.lane,
          description: `Lane '${lf.lane}': avg ${avgOverflow.toFixed(1)} overflows/outcome suggests cap too tight`,
          evidence: {
            metric: 'avgOverflowPerOutcome',
            observedValue: avgOverflow,
            thresholdValue: thresholds.overflowPressureThreshold,
            outcomeIds: getLaneOutcomeIds(outcomeStore, routingStore, lf.lane, lf.policySetId),
            sampleSize: lf.closedOutcomes,
          },
        });
      }
    }

    // Routing churn per lane
    const avgReroutes = lf.totalReroutes / lf.closedOutcomes;
    if (avgReroutes >= thresholds.routingChurnThreshold) {
      signals.push({
        code: 'routing_churn',
        severity: avgReroutes >= thresholds.routingChurnThreshold * 2 ? 'high' : 'medium',
        lane: lf.lane,
        description: `Lane '${lf.lane}': avg ${avgReroutes.toFixed(1)} reroutes/outcome suggests routing defaults problematic`,
        evidence: {
          metric: 'avgReroutesPerOutcome',
          observedValue: avgReroutes,
          thresholdValue: thresholds.routingChurnThreshold,
          outcomeIds: getLaneOutcomeIds(outcomeStore, routingStore, lf.lane, lf.policySetId),
          sampleSize: lf.closedOutcomes,
        },
      });
    }

    // Lane-specific churn
    if (lf.churnRate > thresholds.churnRateThreshold) {
      signals.push({
        code: 'chronic_churn',
        severity: severityFromRate(lf.churnRate, thresholds.churnRateThreshold),
        lane: lf.lane,
        description: `Lane '${lf.lane}': churn rate ${pct(lf.churnRate)} exceeds threshold`,
        evidence: {
          metric: 'laneChurnRate',
          observedValue: lf.churnRate,
          thresholdValue: thresholds.churnRateThreshold,
          outcomeIds: getLaneOutcomeIds(outcomeStore, routingStore, lf.lane, lf.policySetId),
          sampleSize: lf.closedOutcomes,
        },
      });
    }

    // Lane-specific intervention dependency
    if (lf.interventionRate > thresholds.interventionRateThreshold) {
      signals.push({
        code: 'intervention_dependency',
        severity: severityFromRate(lf.interventionRate, thresholds.interventionRateThreshold),
        lane: lf.lane,
        description: `Lane '${lf.lane}': intervention rate ${pct(lf.interventionRate)} exceeds threshold`,
        evidence: {
          metric: 'laneInterventionRate',
          observedValue: lf.interventionRate,
          thresholdValue: thresholds.interventionRateThreshold,
          outcomeIds: getLaneOutcomeIds(outcomeStore, routingStore, lf.lane, lf.policySetId),
          sampleSize: lf.closedOutcomes,
        },
      });
    }
  }

  return signals;
}

// ── Helpers ──────────────────────────────────────────────────────────

function severityFromRate(observed: number, threshold: number): PainSeverity {
  const ratio = observed / threshold;
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function msToMin(ms: number): number {
  return Math.round(ms / 60000);
}

function getChurnOutcomeIds(store: OutcomeStore, policySetId: string): string[] {
  return store.listOutcomes({ policySetId, status: 'closed' })
    .filter(o => o.resolutionQuality === 'churn_heavy')
    .map(o => o.outcomeId);
}

function getRecoveryOutcomeIds(store: OutcomeStore, policySetId: string): string[] {
  return store.listOutcomes({ policySetId, status: 'closed' })
    .filter(o => o.resolutionQuality === 'recovery_heavy')
    .map(o => o.outcomeId);
}

function getInterventionOutcomeIds(store: OutcomeStore, policySetId: string): string[] {
  return store.listOutcomes({ policySetId, status: 'closed' })
    .filter(o => o.resolutionQuality === 'intervention_assisted')
    .map(o => o.outcomeId);
}

function getLaneOutcomeIds(
  store: OutcomeStore,
  routingStore: RoutingStore,
  lane: RoutingLane,
  policySetId: string | null,
): string[] {
  const outcomes = store.listOutcomes(
    policySetId ? { policySetId, status: 'closed' } : { status: 'closed' },
  );
  return outcomes
    .filter(o => {
      const route = routingStore.getActiveRoute(o.queueItemId);
      return route?.lane === lane;
    })
    .map(o => o.outcomeId);
}
