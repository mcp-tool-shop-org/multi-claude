/**
 * Calibration Law — Report Builder.
 *
 * Assembles a complete calibration report by composing:
 *   - Policy fitness derivation
 *   - Lane fitness derivation
 *   - Pain detection
 *   - Policy adjustment proposals
 *
 * The report is a durable snapshot bound to exact outcomes and policy versions.
 */

import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { PolicyStore } from '../policy/policy-store.js';
import type { CalibrationStore } from './calibration-store.js';
import type { RoutingLane } from '../routing/types.js';
import type { CalibrationReport, CalibrationThresholds } from './types.js';
import { DEFAULT_CALIBRATION_THRESHOLDS } from './types.js';
import { derivePolicyFitness } from './derive-policy-fitness.js';
import { deriveAllLaneFitness, deriveLaneFitness } from './derive-lane-fitness.js';
import { detectPolicyPain } from './detect-policy-pain.js';
import { proposePolicyAdjustments } from './propose-policy-adjustments.js';
import { resolveActivePolicy } from '../policy/policy-actions.js';
import { generateId, nowISO } from '../../lib/ids.js';

export interface BuildCalibrationResult {
  ok: true;
  report: CalibrationReport;
}

export interface BuildCalibrationError {
  ok: false;
  error: string;
  code: 'insufficient_data' | 'no_policy';
}

/**
 * Build a calibration report for the active policy (or a specific policy).
 */
export function buildCalibrationReport(
  outcomeStore: OutcomeStore,
  routingStore: RoutingStore,
  policyStore: PolicyStore,
  calibrationStore: CalibrationStore,
  opts?: {
    policySetId?: string;
    lane?: RoutingLane;
    scope?: string;
    thresholds?: CalibrationThresholds;
    persist?: boolean;
  },
): BuildCalibrationResult | BuildCalibrationError {
  const scope = opts?.scope ?? 'global';
  const thresholds = opts?.thresholds ?? DEFAULT_CALIBRATION_THRESHOLDS;
  const persist = opts?.persist !== false;

  // Resolve policy
  let policySetId: string | null = opts?.policySetId ?? null;
  let policyVersion: number | null = null;

  if (policySetId) {
    const ps = policyStore.getPolicySet(policySetId);
    if (ps) policyVersion = ps.policyVersion;
  } else {
    const active = resolveActivePolicy(policyStore, scope);
    policySetId = active.policySetId;
    policyVersion = active.policyVersion;
  }

  // Derive policy fitness
  let policyFitness = null;
  if (policySetId && policyVersion !== null) {
    policyFitness = derivePolicyFitness(outcomeStore, policySetId, policyVersion, scope);
  }

  // Derive lane fitness
  const laneFitness = opts?.lane
    ? [deriveLaneFitness(outcomeStore, routingStore, opts.lane, policySetId)]
    : deriveAllLaneFitness(outcomeStore, routingStore, policySetId);

  // Count outcomes
  const allOutcomes = outcomeStore.listOutcomes(
    policySetId ? { policySetId } : undefined,
  );
  const closedOutcomes = allOutcomes.filter(o => o.status === 'closed');

  // Check minimum data
  if (closedOutcomes.length < thresholds.minOutcomesForCalibration) {
    return {
      ok: false,
      error: `Insufficient data: ${closedOutcomes.length} closed outcomes (need ${thresholds.minOutcomesForCalibration})`,
      code: 'insufficient_data',
    };
  }

  // Detect pain
  const painSignals = detectPolicyPain(
    policyFitness, laneFitness, outcomeStore, routingStore, thresholds,
  );

  // Propose adjustments
  const adjustments = proposePolicyAdjustments(policyStore, painSignals, scope);

  // Determine outcome window
  const sortedByOpen = closedOutcomes.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const from = sortedByOpen.length > 0 ? sortedByOpen[0]!.openedAt : null;
  const to = sortedByOpen.length > 0 ? sortedByOpen[sortedByOpen.length - 1]!.closedAt : null;

  // Build summary
  const summary = buildSummary(policyFitness, laneFitness, painSignals, adjustments);

  const report: CalibrationReport = {
    reportId: generateId('cal'),
    policySetId,
    policyVersion,
    scope,
    createdAt: nowISO(),
    outcomeWindow: {
      from,
      to,
      totalOutcomes: allOutcomes.length,
      closedOutcomes: closedOutcomes.length,
    },
    policyFitness,
    laneFitness,
    painSignals,
    adjustments,
    summary,
  };

  if (persist) {
    calibrationStore.insertReport(report);
  }

  return { ok: true, report };
}

function buildSummary(
  policyFitness: CalibrationReport['policyFitness'],
  laneFitness: CalibrationReport['laneFitness'],
  painSignals: CalibrationReport['painSignals'],
  adjustments: CalibrationReport['adjustments'],
): string {
  const parts: string[] = [];

  if (policyFitness) {
    parts.push(`Policy v${policyFitness.policyVersion}: ${policyFitness.closedOutcomes} closed outcomes`);
    parts.push(`Clean ${pct(policyFitness.cleanRate)}, Churn ${pct(policyFitness.churnRate)}, Recovery ${pct(policyFitness.recoveryRate)}, Intervention ${pct(policyFitness.interventionRate)}`);
    if (policyFitness.meanLeadTimeMs !== null) {
      parts.push(`Mean lead time: ${Math.round(policyFitness.meanLeadTimeMs / 60000)}m`);
    }
  } else {
    parts.push('No active policy (using defaults)');
  }

  const activeLanes = laneFitness.filter(lf => lf.closedOutcomes > 0);
  if (activeLanes.length > 0) {
    parts.push(`Active lanes: ${activeLanes.map(lf => `${lf.lane}(${lf.closedOutcomes})`).join(', ')}`);
  }

  if (painSignals.length > 0) {
    const high = painSignals.filter(s => s.severity === 'high').length;
    const medium = painSignals.filter(s => s.severity === 'medium').length;
    const low = painSignals.filter(s => s.severity === 'low').length;
    parts.push(`Pain: ${painSignals.length} signals (${high} high, ${medium} medium, ${low} low)`);
  } else {
    parts.push('No pain signals detected');
  }

  if (adjustments.length > 0) {
    parts.push(`${adjustments.length} adjustment(s) proposed`);
  }

  return parts.join(' — ');
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}
