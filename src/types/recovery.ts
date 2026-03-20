/**
 * Canonical recovery types — Phase 9E.
 *
 * Recovery is a derived guidance layer. It reads existing truth
 * (run state, action availability, refusals, audit history) and
 * produces a RecoveryPlan that tells the operator what to do next.
 *
 * No mutable recovery state. No shadow executor. No auto-healing.
 * See Phase 9E contract: docs/trials/9E-000-CONTRACT-FREEZE.md
 */

import type { OperatorAction, ActionTargetType, Precondition } from './actions.js';

// ── Recovery scenarios ──────────────────────────────────────────────

/**
 * Stable scenario IDs — not prose. Each maps to a known
 * blockage/failure class with a finite recovery pattern.
 */
export type RecoveryScenarioId =
  | 'failed_packet_retryable'
  | 'failed_packet_exhausted'
  | 'run_blocked_dependencies'
  | 'resume_blocked_by_gate'
  | 'resume_blocked_by_failure'
  | 'hook_pending_approval'
  | 'no_legal_action'
  | 'multi_issue_triage';

/** All known recovery scenarios, for guard tests. */
export const RECOVERY_SCENARIOS: ReadonlySet<RecoveryScenarioId> = new Set([
  'failed_packet_retryable',
  'failed_packet_exhausted',
  'run_blocked_dependencies',
  'resume_blocked_by_gate',
  'resume_blocked_by_failure',
  'hook_pending_approval',
  'no_legal_action',
  'multi_issue_triage',
]);

// ── Recovery severity ───────────────────────────────────────────────

/** How urgent the recovery is. */
export type RecoverySeverity = 'critical' | 'actionable' | 'waiting';

// ── Recovery step kinds ─────────────────────────────────────────────

/**
 * What kind of step this is:
 * - operator_action: maps to an existing console act command
 * - diagnostic: read-only investigation the operator should do
 * - wait: system is working, operator should let it proceed
 * - manual_fix: requires human work outside the CLI
 */
export type RecoveryStepKind = 'operator_action' | 'diagnostic' | 'wait' | 'manual_fix';

// ── Recovery step ───────────────────────────────────────────────────

/**
 * One step in a recovery plan. Steps are ordered — earlier steps
 * should be attempted before later ones.
 */
export interface RecoveryStep {
  id: string;                          // stable step ID within the plan
  kind: RecoveryStepKind;
  title: string;                       // short imperative description
  reason: string;                      // why this step exists
  legalNow: boolean;                   // can this step be taken immediately?
  action: OperatorAction | null;       // existing operator action, if kind is operator_action
  targetType: ActionTargetType | null; // what the action targets
  targetId: string | null;             // specific target entity
  command: string | null;              // CLI command to execute (null for non-action steps)
  preconditions: Precondition[];       // what must be true for this step to become legal
  expectedUnlock: string;              // what becomes legal or possible after this step
  blockedReason: string | null;        // why this step is not legal now (null if legal)
}

// ── Recovery blocker ────────────────────────────────────────────────

/**
 * The dominant thing preventing progress. A plan has exactly one
 * primary blocker (even if multiple issues exist).
 */
export interface RecoveryBlocker {
  summary: string;                     // one-line description of what's blocking
  targetType: ActionTargetType | 'system';
  targetId: string | null;
  failedPreconditions: Precondition[]; // the specific checks that failed
}

// ── Terminal condition ──────────────────────────────────────────────

/**
 * When is the run "recovered"? This describes the exit condition
 * for the recovery plan — the state that means normal operation
 * can resume.
 */
export interface RecoveryTerminalCondition {
  description: string;                 // human-readable exit condition
  checkCommand: string | null;         // CLI command to verify recovery
}

// ── Recovery plan ───────────────────────────────────────────────────

/**
 * The complete recovery guidance for a target. Derived from
 * existing truth, never stored.
 */
export interface RecoveryPlan {
  scenario: RecoveryScenarioId;
  targetType: ActionTargetType | 'run';
  targetId: string;
  summary: string;                     // one-sentence description of the situation
  severity: RecoverySeverity;
  blocker: RecoveryBlocker;
  steps: RecoveryStep[];               // ordered recovery sequence
  currentStepIndex: number;            // index of the first legal step (-1 if none legal)
  terminalCondition: RecoveryTerminalCondition;
  derivedFrom: {                       // provenance — what truth produced this plan
    runStatus: string;
    nextAction: string | null;
    refusalReasons: string[];
    failedPreconditions: string[];
  };
}

// ── No-recovery sentinel ────────────────────────────────────────────

/**
 * When no recovery is needed (run is healthy or terminal).
 */
export interface NoRecoveryNeeded {
  scenario: 'no_recovery_needed';
  targetId: string;
  reason: string;
}

/** Result of attempting to derive a recovery plan. */
export type RecoveryResult = RecoveryPlan | NoRecoveryNeeded;
