/**
 * Calibration Law — Policy Adjustment Proposals.
 *
 * Generates structured, evidence-backed policy change proposals
 * from pain signals. Never auto-activates — human must review and apply.
 */

import type { PolicyStore } from '../policy/policy-store.js';
import type { PolicyContent } from '../policy/types.js';
import { resolveActivePolicy } from '../policy/policy-actions.js';
import type { PainSignal, PolicyAdjustment, AdjustmentEvidence } from './types.js';
import { generateId } from '../../lib/ids.js';

/**
 * Propose policy adjustments based on detected pain signals.
 * Returns structured proposals — never mutates policy.
 */
export function proposePolicyAdjustments(
  policyStore: PolicyStore,
  painSignals: PainSignal[],
  scope: string = 'global',
): PolicyAdjustment[] {
  const active = resolveActivePolicy(policyStore, scope);
  const content = active.content;
  const adjustments: PolicyAdjustment[] = [];

  for (const signal of painSignals) {
    const proposals = deriveAdjustmentsFromSignal(signal, content, active.policySetId, active.policyVersion);
    adjustments.push(...proposals);
  }

  // Deduplicate: if multiple signals propose the same field change, keep the highest confidence
  return deduplicateAdjustments(adjustments);
}

function deriveAdjustmentsFromSignal(
  signal: PainSignal,
  content: PolicyContent,
  policySetId: string | null,
  policyVersion: number | null,
): PolicyAdjustment[] {
  const evidence: AdjustmentEvidence = {
    outcomeCount: signal.evidence.sampleSize,
    affectedOutcomeIds: signal.evidence.outcomeIds,
    policySetId: policySetId ?? 'default',
    policyVersion: policyVersion ?? 0,
    painSignals: [signal],
  };

  const adjustments: PolicyAdjustment[] = [];

  switch (signal.code) {
    case 'cap_too_tight': {
      if (signal.lane) {
        const currentCap = content.laneCaps[signal.lane];
        const proposed = Math.ceil(currentCap * 1.5);
        adjustments.push({
          adjustmentId: generateId('adj'),
          kind: 'increase_cap',
          lane: signal.lane,
          field: `laneCaps.${signal.lane}`,
          currentValue: currentCap,
          proposedValue: proposed,
          rationale: `Lane '${signal.lane}' overflow pressure suggests cap ${currentCap} is too tight. Proposing ${proposed}.`,
          painCodes: [signal.code],
          confidence: signal.severity === 'high' ? 'high' : 'medium',
          evidence,
        });
      }
      break;
    }

    case 'chronic_churn': {
      // Churn often means claims expire or get released too often
      // Suggest increasing lease duration if it's a global signal
      if (!signal.lane) {
        const currentLease = content.leaseDurationMs;
        const proposed = Math.ceil(currentLease * 1.5);
        adjustments.push({
          adjustmentId: generateId('adj'),
          kind: 'adjust_lease_duration',
          lane: null,
          field: 'leaseDurationMs',
          currentValue: currentLease,
          proposedValue: proposed,
          rationale: `Churn rate ${(signal.evidence.observedValue * 100).toFixed(0)}% suggests lease duration too short. Proposing ${Math.round(proposed / 60000)}m.`,
          painCodes: [signal.code],
          confidence: signal.severity === 'high' ? 'high' : 'medium',
          evidence,
        });
      }
      break;
    }

    case 'excessive_recovery': {
      // Recovery overuse may mean thresholds are too sensitive
      const currentThrottle = content.recoveryThrottle;
      const proposed = Math.ceil(currentThrottle * 1.5);
      adjustments.push({
        adjustmentId: generateId('adj'),
        kind: 'adjust_recovery_throttle',
        lane: null,
        field: 'recoveryThrottle',
        currentValue: currentThrottle,
        proposedValue: proposed,
        rationale: `Recovery rate ${(signal.evidence.observedValue * 100).toFixed(0)}% suggests throttle too permissive. Proposing ${proposed}.`,
        painCodes: [signal.code],
        confidence: signal.severity === 'high' ? 'medium' : 'low',
        evidence,
      });
      break;
    }

    case 'intervention_dependency': {
      // Frequent interventions suggest breach thresholds too sensitive
      if (signal.lane) {
        const currentOverflow = content.overflowThreshold[signal.lane];
        const proposed = Math.ceil(currentOverflow * 1.5);
        adjustments.push({
          adjustmentId: generateId('adj'),
          kind: 'increase_overflow_threshold',
          lane: signal.lane,
          field: `overflowThreshold.${signal.lane}`,
          currentValue: currentOverflow,
          proposedValue: proposed,
          rationale: `Lane '${signal.lane}' intervention rate ${(signal.evidence.observedValue * 100).toFixed(0)}% suggests overflow threshold too tight.`,
          painCodes: [signal.code],
          confidence: 'medium',
          evidence,
        });
      } else {
        const currentSat = content.breachThresholds.saturationChecks;
        const proposed = Math.ceil(currentSat * 1.5);
        adjustments.push({
          adjustmentId: generateId('adj'),
          kind: 'increase_breach_threshold',
          lane: null,
          field: 'breachThresholds.saturationChecks',
          currentValue: currentSat,
          proposedValue: proposed,
          rationale: `Intervention rate ${(signal.evidence.observedValue * 100).toFixed(0)}% suggests breach thresholds too sensitive.`,
          painCodes: [signal.code],
          confidence: 'medium',
          evidence,
        });
      }
      break;
    }

    case 'slow_resolution': {
      // Slow resolution might benefit from shorter starvation thresholds
      // to surface blocked items faster
      if (signal.lane) {
        const currentStarv = content.starvationThresholdMs[signal.lane];
        const proposed = Math.floor(currentStarv * 0.75);
        if (proposed >= 1000) {
          adjustments.push({
            adjustmentId: generateId('adj'),
            kind: 'decrease_starvation_threshold',
            lane: signal.lane,
            field: `starvationThresholdMs.${signal.lane}`,
            currentValue: currentStarv,
            proposedValue: proposed,
            rationale: `Slow resolution in '${signal.lane}'. Reducing starvation threshold to surface stuck items faster.`,
            painCodes: [signal.code],
            confidence: 'low',
            evidence,
          });
        }
      }
      break;
    }

    case 'routing_churn': {
      // Excessive reroutes suggest initial routing defaults are wrong
      // Flag for human review — no automatic fix
      if (signal.lane) {
        adjustments.push({
          adjustmentId: generateId('adj'),
          kind: 'adjust_routing_default',
          lane: signal.lane,
          field: `routingDefaults.${signal.lane}`,
          currentValue: content.routingDefaults[signal.lane],
          proposedValue: null, // human must decide
          rationale: `Lane '${signal.lane}' avg ${signal.evidence.observedValue.toFixed(1)} reroutes/outcome suggests routing defaults need review.`,
          painCodes: [signal.code],
          confidence: 'low',
          evidence,
        });
      }
      break;
    }

    case 'claim_churn':
    case 'recovery_storm':
    case 'starvation_pattern':
    case 'overflow_pressure':
    case 'cap_too_loose':
    case 'threshold_drift':
      // These may generate proposals in future calibration refinements
      break;
  }

  return adjustments;
}

function deduplicateAdjustments(adjustments: PolicyAdjustment[]): PolicyAdjustment[] {
  const seen = new Map<string, PolicyAdjustment>();
  for (const adj of adjustments) {
    const key = `${adj.kind}:${adj.field}:${adj.lane ?? 'global'}`;
    const existing = seen.get(key);
    if (!existing || confidenceRank(adj.confidence) > confidenceRank(existing.confidence)) {
      seen.set(key, adj);
    }
  }
  return Array.from(seen.values());
}

function confidenceRank(c: 'low' | 'medium' | 'high'): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}
