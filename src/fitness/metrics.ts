/**
 * Canonical Metric Registry — single source of truth for all scored metrics.
 *
 * Every metric must define: key, bucket, weight, formula description, source, direction, gaming risk.
 * If a metric cannot be defined this way, it should not be scored.
 */

import type { PacketClass } from './types.js';

export interface MetricDefinition {
  key: string;
  bucket: 'quality' | 'lawfulness' | 'collaboration' | 'velocity';
  weight: number;
  description: string;
  formula: string;
  source: string;
  /** 'higher_better' = more is good, 'lower_better' = less is good */
  direction: 'higher_better' | 'lower_better';
  gamingRisk: string;
  /** Which packet classes this applies to (null = all) */
  applicableClasses: PacketClass[] | null;
}

export const METRIC_REGISTRY: MetricDefinition[] = [
  // ── Quality (40 points) ──────────────────────────────
  {
    key: 'verified_completion_rate',
    bucket: 'quality', weight: 12,
    description: 'Fraction of packets that reach verified state',
    formula: 'verified_packets / total_packets',
    source: 'packets.status',
    direction: 'higher_better',
    gamingRisk: 'Workers may submit trivially to boost rate — mitigated by verification independence',
    applicableClasses: null,
  },
  {
    key: 'integration_success_rate',
    bucket: 'quality', weight: 10,
    description: 'Fraction of verified packets that survive integration',
    formula: 'integrated_packets / verified_packets',
    source: 'integration_runs + packets.status',
    direction: 'higher_better',
    gamingRisk: 'Low if verification is strict',
    applicableClasses: null,
  },
  {
    key: 'build_test_pass_rate',
    bucket: 'quality', weight: 8,
    description: 'Fraction of verification checks that pass',
    formula: 'passing_checks / total_checks',
    source: 'verification_results.checks_json',
    direction: 'higher_better',
    gamingRisk: 'Workers may skip hard tests — mitigated by independent verifier',
    applicableClasses: null,
  },
  {
    key: 'reopen_rate',
    bucket: 'quality', weight: 5,
    description: 'Fraction of packets NOT reopened (1 = no reopens)',
    formula: '1 - (reopened_packets / total_packets)',
    source: 'state_transition_log (verified→failed or merged→failed)',
    direction: 'higher_better',
    gamingRisk: 'Low — reopens are externally driven',
    applicableClasses: null,
  },
  {
    key: 'reconciliation_pass_rate',
    bucket: 'quality', weight: 5,
    description: 'Fraction of reconciliations that pass cleanly',
    formula: 'clean_reconciliations / total_reconciliations',
    source: 'runtime_envelopes.diffReconciliationVerdict',
    direction: 'higher_better',
    gamingRisk: 'Workers may under-report files — mitigated by diff reconciliation',
    applicableClasses: null,
  },

  // ── Lawfulness (25 points) ───────────────────────────
  {
    key: 'transition_compliance',
    bucket: 'lawfulness', weight: 8,
    description: 'Fraction of state transitions that are lawful',
    formula: 'lawful_transitions / total_transitions',
    source: 'state_transition_log',
    direction: 'higher_better',
    gamingRisk: 'None — transitions are CLI-enforced',
    applicableClasses: null,
  },
  {
    key: 'envelope_completeness',
    bucket: 'lawfulness', weight: 6,
    description: 'Fraction of sessions with complete runtime envelopes',
    formula: 'complete_envelopes / total_sessions',
    source: 'runtime_envelopes',
    direction: 'higher_better',
    gamingRisk: 'None — envelopes are system-written',
    applicableClasses: null,
  },
  {
    key: 'stop_retry_correctness',
    bucket: 'lawfulness', weight: 4,
    description: 'Fraction of stop/retry events handled lawfully',
    formula: 'correct_stops / total_stops',
    source: 'runtime_envelopes where stopReason in (stopped, timed_out)',
    direction: 'higher_better',
    gamingRisk: 'None — stop path is system-controlled',
    applicableClasses: null,
  },
  {
    key: 'hook_logging_coverage',
    bucket: 'lawfulness', weight: 4,
    description: 'Fraction of expected hook decisions that were logged',
    formula: 'logged_decisions / expected_decisions',
    source: 'hook_decisions',
    direction: 'higher_better',
    gamingRisk: 'None — hooks are system-fired',
    applicableClasses: null,
  },
  {
    key: 'artifact_validity',
    bucket: 'lawfulness', weight: 3,
    description: 'Fraction of submissions with valid artifact schema',
    formula: 'valid_artifacts / total_submissions',
    source: 'packet_submissions validation',
    direction: 'higher_better',
    gamingRisk: 'Workers may produce minimal valid JSON — mitigated by writeback quality checks',
    applicableClasses: null,
  },

  // ── Collaboration (20 points) ────────────────────────
  {
    key: 'manual_rescue_rate',
    bucket: 'collaboration', weight: 6,
    description: 'Fraction of packets NOT requiring manual operator rescue',
    formula: '1 - (rescue_events / total_packets)',
    source: 'operator intervention log / manual state transitions',
    direction: 'higher_better',
    gamingRisk: 'Operators may under-report rescues — mitigated by transition log audit',
    applicableClasses: null,
  },
  {
    key: 'merge_friction',
    bucket: 'collaboration', weight: 5,
    description: 'Fraction of packets with clean merge (no conflicts)',
    formula: '1 - (conflict_packets / total_packets)',
    source: 'integration_runs notes / seam changes',
    direction: 'higher_better',
    gamingRisk: 'Low — merge friction is observable',
    applicableClasses: null,
  },
  {
    key: 'downstream_success',
    bucket: 'collaboration', weight: 4,
    description: 'Fraction of handoffs where downstream packet succeeded cleanly',
    formula: 'clean_downstream / total_dependent_packets',
    source: 'packet_dependencies + packet status chains',
    direction: 'higher_better',
    gamingRisk: 'Attribution may be fuzzy — use as diagnostic, not punitive',
    applicableClasses: null,
  },
  {
    key: 'verifier_useful_find_rate',
    bucket: 'collaboration', weight: 3,
    description: 'Fraction of verifier findings that were real defects (not false positives)',
    formula: 'real_finds / total_findings',
    source: 'verification_results',
    direction: 'higher_better',
    gamingRisk: 'Verifiers may under-report to avoid false-positive penalty — balance with thoroughness expectation',
    applicableClasses: ['verification'],
  },
  {
    key: 'knowledge_reuse',
    bucket: 'collaboration', weight: 2,
    description: 'Fraction of knowledge promotions that were referenced by later runs',
    formula: 'reused_promotions / total_promotions',
    source: 'knowledge_promotions + later run references',
    direction: 'higher_better',
    gamingRisk: 'Hard to game — reuse is externally validated',
    applicableClasses: ['docs_knowledge'],
  },

  // ── Velocity (15 points) ─────────────────────────────
  {
    key: 'duration_vs_budget',
    bucket: 'velocity', weight: 6,
    description: 'Average class-normalized duration score across packets',
    formula: 'avg(packet_duration_score) where score = 1.0 if within budget, decay to 0 at 2x ceiling',
    source: 'runtime_envelopes startedAt/completedAt + packet class',
    direction: 'higher_better',
    gamingRisk: 'Workers may rush to stay under budget — mitigated by quality/lawfulness dominating total score',
    applicableClasses: null,
  },
  {
    key: 'time_to_verified',
    bucket: 'velocity', weight: 4,
    description: 'Average time from packet creation to verified state',
    formula: '1 - (avg_verify_time / max_expected_verify_time)',
    source: 'packets.created_at → verification_results.completed_at',
    direction: 'higher_better',
    gamingRisk: 'Same as duration — mitigated by quality weighting',
    applicableClasses: null,
  },
  {
    key: 'time_to_integrated',
    bucket: 'velocity', weight: 3,
    description: 'Average time from packet creation to merged state',
    formula: '1 - (avg_integrate_time / max_expected_integrate_time)',
    source: 'packets.created_at → integration_runs.completed_at',
    direction: 'higher_better',
    gamingRisk: 'Same as duration',
    applicableClasses: null,
  },
  {
    key: 'queue_latency',
    bucket: 'velocity', weight: 2,
    description: 'Average wait time between packet ready and claim',
    formula: '1 - (avg_wait / max_expected_wait)',
    source: 'packets status timestamps',
    direction: 'higher_better',
    gamingRisk: 'None — queue latency is system-driven',
    applicableClasses: null,
  },
];

/** Get metrics by bucket */
export function getMetricsByBucket(bucket: MetricDefinition['bucket']): MetricDefinition[] {
  return METRIC_REGISTRY.filter(m => m.bucket === bucket);
}

/** Get a specific metric */
export function getMetric(key: string): MetricDefinition | undefined {
  return METRIC_REGISTRY.find(m => m.key === key);
}

/** Validate weights sum correctly per bucket */
export function validateRegistryWeights(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const bucketSums: Record<string, number> = {};

  for (const m of METRIC_REGISTRY) {
    bucketSums[m.bucket] = (bucketSums[m.bucket] ?? 0) + m.weight;
  }

  const expected: Record<string, number> = { quality: 40, lawfulness: 25, collaboration: 20, velocity: 15 };

  for (const [bucket, expectedWeight] of Object.entries(expected)) {
    const actual = bucketSums[bucket] ?? 0;
    if (actual !== expectedWeight) {
      errors.push(`${bucket}: expected ${expectedWeight}, got ${actual}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
