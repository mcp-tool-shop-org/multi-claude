import type { HookEventPayload } from './events.js';
import type { EvaluatedConditions } from './conditions.js';
import type { HookAction, HookDecision } from './actions.js';
import { makeDecision } from './actions.js';

export const MAX_RETRIES = 3;

export type PolicyMode = 'advisory' | 'autonomous';

interface PolicyRule {
  id: string;
  name: string;
  event: string;
  mode: PolicyMode;
  evaluate: (conditions: EvaluatedConditions, event: HookEventPayload) => HookDecision | null;
}

/** The initial policy rules — matches HOOK-POLICY.md Section 7 */
export const POLICY_RULES: PolicyRule[] = [
  // Rule 1: Auto-launch parallel wave
  {
    id: 'rule_1_auto_launch_parallel_wave',
    name: 'Auto-launch parallel wave',
    event: 'packet.verified',
    mode: 'advisory',
    evaluate: (c, _e) => {
      if (c.claimableCount < 2) return null;
      if (c.fileOverlap) return null;
      if (c.hasProtectedFiles) return null;
      if (c.phaseType === 'scaffold') return null;
      if (c.graphDepth < 2) return null;

      return makeDecision(
        'launch_workers',
        c.claimablePackets,
        'builder',
        `${c.claimableCount} claimable packets with no file overlap, graph depth ${c.graphDepth}`,
      );
    },
  },

  // Rule 1b: Also fires on wave.claimable
  {
    id: 'rule_1b_wave_claimable',
    name: 'Auto-launch on wave claimable',
    event: 'wave.claimable',
    mode: 'advisory',
    evaluate: (c, _e) => {
      if (c.claimableCount < 2) return null;
      if (c.fileOverlap) return null;
      if (c.hasProtectedFiles) return null;
      if (c.phaseType === 'scaffold') return null;
      if (c.graphDepth < 2) return null;

      return makeDecision(
        'launch_workers',
        c.claimablePackets,
        'builder',
        `Wave claimable: ${c.claimableCount} parallel packets available`,
      );
    },
  },

  // Rule 2: Stay single-Claude on foundation work
  {
    id: 'rule_2_stay_single_foundation',
    name: 'Stay single-Claude on foundation',
    event: 'feature.approved',
    mode: 'autonomous',
    evaluate: (c, _e) => {
      if (c.phaseType === 'scaffold' || c.criticalPathDepth <= 2) {
        return makeDecision(
          'stay_single',
          [],
          'operator',
          'Foundation work has weak parallelism and high coordination cost',
        );
      }
      return null;
    },
  },

  // Rule 3: Auto-launch docs/knowledge
  {
    id: 'rule_3_auto_launch_docs',
    name: 'Auto-launch docs worker',
    event: 'packet.verified',
    mode: 'advisory',
    evaluate: (c, _e) => {
      if (!c.docsEligible) return null;

      return makeDecision(
        'launch_docs',
        [],
        'docs',
        `${c.verifiedCount} packets verified, docs packet ready`,
      );
    },
  },

  // Rule 4a: Retry on deterministic failure
  {
    id: 'rule_4a_retry_deterministic',
    name: 'Retry on deterministic failure',
    event: 'packet.failed',
    mode: 'advisory',
    evaluate: (c, e) => {
      if (c.failureClass !== 'deterministic') return null;
      if (c.failureClass === 'scope_violation' as string) return null;
      if (c.retryCount >= MAX_RETRIES) return null;

      return makeDecision(
        'retry_once',
        [e.entityId],
        'builder',
        `Deterministic failure, attempt ${c.retryCount + 1} of ${MAX_RETRIES} — retry with fresh worker`,
      );
    },
  },

  // Rule 4b: Verifier-analysis after retry failure
  {
    id: 'rule_4b_verifier_analysis',
    name: 'Launch verifier-analysis after retry',
    event: 'packet.failed',
    mode: 'advisory',
    evaluate: (c, e) => {
      if (c.failureClass !== 'deterministic') return null;
      if (c.retryCount < MAX_RETRIES) return null;

      return makeDecision(
        'launch_verifier',
        [e.entityId],
        'verifier-analysis',
        `Deterministic failure after ${MAX_RETRIES} retries — launch analysis`,
      );
    },
  },

  // Rule 4c: Escalate after retry limit
  {
    id: 'rule_4c_retry_limit',
    name: 'Escalate after retry limit',
    event: 'packet.failed',
    mode: 'advisory',
    evaluate: (c, e) => {
      if (c.failureClass !== 'deterministic') return null;
      if (c.retryCount < MAX_RETRIES) return null;
      return makeDecision(
        'escalate_human' as HookAction,
        [e.entityId],
        'operator',
        `Deterministic failure after ${MAX_RETRIES} retries — escalate to human`,
      );
    },
  },

  // Rule 5: Integration pause
  {
    id: 'rule_5_integration_pause',
    name: 'Pause for merge approval',
    event: 'integration.ready',
    mode: 'autonomous',
    evaluate: (c, _e) => {
      if (!c.allPacketsVerified) return null;
      if (!c.allPromotionsComplete) return null;

      return makeDecision(
        'pause_human_gate',
        [],
        'integrator',
        'All packets verified and promoted — merge approval required',
        { requiresHumanApproval: true },
      );
    },
  },

  // Rule 6: Resume after approval
  {
    id: 'rule_6_resume_after_approval',
    name: 'Resume integration after approval',
    event: 'approval.recorded',
    mode: 'autonomous',
    evaluate: (c, _e) => {
      if (!c.hasMergeApproval) return null;
      if (!c.allPacketsVerified) return null;

      return makeDecision(
        'resume_integration',
        [],
        'integrator',
        'Merge approved — resume integration',
      );
    },
  },

  // Rule 7: Stall detection
  {
    id: 'rule_7_stall_detection',
    name: 'Detect stalled queue',
    event: 'queue.stalled',
    mode: 'autonomous',
    evaluate: (c, _e) => {
      if (c.claimableCount > 0) return null;
      if (c.activeWorkers > 0) return null;

      return makeDecision(
        'surface_blocker',
        [],
        'operator',
        'No claimable packets, no active workers, feature incomplete — diagnose blocker',
      );
    },
  },

  // Rule 8: Scope violation rejection
  {
    id: 'rule_8_scope_violation',
    name: 'Reject scope violations',
    event: 'packet.failed',
    mode: 'autonomous',
    evaluate: (c, e) => {
      if (c.failureClass !== 'scope_violation') return null;

      return makeDecision(
        'escalate',
        [e.entityId],
        'operator',
        'Scope violation indicates packet design error — do not retry',
      );
    },
  },
];

/** Find the first matching rule for an event */
export function evaluatePolicy(
  event: HookEventPayload,
  conditions: EvaluatedConditions,
  _mode: PolicyMode = 'advisory',
): { rule: PolicyRule; decision: HookDecision } | null {
  for (const rule of POLICY_RULES) {
    // Event must match
    if (rule.event !== event.event) continue;

    // In advisory mode, all rules are evaluated
    // In autonomous mode, only autonomous rules auto-execute; advisory rules still recommend
    const decision = rule.evaluate(conditions, event);
    if (decision) {
      return { rule, decision };
    }
  }
  return null;
}
