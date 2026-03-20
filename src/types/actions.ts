/**
 * Canonical action types, target types, and refusal detail shapes.
 *
 * ALL consumers must import from here — no local redefinition.
 * See Phase 9D contract: docs/trials/9D-000-CONTRACT-FREEZE.md
 *
 * Two action namespaces:
 *   - OperatorAction: imperative (stop, retry, resume, approve, resolve)
 *   - HookAction: strategic (launch_workers, escalate, etc.)
 *
 * Shared shapes:
 *   - Precondition: individual check result
 *   - ActionAvailability: full availability verdict with preconditions
 *   - ActionResult: execution outcome with audit link
 *   - NextAction: single recommended operator action
 */

import type { OperatorDecision } from './statuses.js';

// ── Operator action catalog ─────────────────────────────────────────

/** The 5 lawful operator actions. Executor's switch must cover all. */
export type OperatorAction =
  | 'stop_run'
  | 'retry_packet'
  | 'resume_run'
  | 'approve_gate'
  | 'resolve_hook';

/** What an operator action targets. */
export type ActionTargetType = 'run' | 'packet' | 'gate' | 'hook_decision';

/** All known operator action names, for guard tests. */
export const OPERATOR_ACTIONS: ReadonlySet<OperatorAction> = new Set([
  'stop_run', 'retry_packet', 'resume_run', 'approve_gate', 'resolve_hook',
]);

// ── Hook action catalog ─────────────────────────────────────────────

/** Actions the policy engine can produce. */
export type HookAction =
  | 'stay_single'
  | 'launch_workers'
  | 'launch_verifier'
  | 'launch_docs'
  | 'retry_once'
  | 'pause_human_gate'
  | 'resume_integration'
  | 'surface_blocker'
  | 'escalate';

/** All known hook action names, for guard tests. */
export const HOOK_ACTIONS: ReadonlySet<HookAction> = new Set([
  'stay_single', 'launch_workers', 'launch_verifier', 'launch_docs',
  'retry_once', 'pause_human_gate', 'resume_integration',
  'surface_blocker', 'escalate',
]);

// ── Hook event catalog ──────────────────────────────────────────────

/** Events emitted by CLI commands that trigger hook evaluation. */
export type HookEvent =
  | 'feature.approved'
  | 'packet.ready'
  | 'packet.claimed'
  | 'packet.verified'
  | 'packet.failed'
  | 'wave.claimable'
  | 'wave.empty'
  | 'integration.ready'
  | 'approval.recorded'
  | 'queue.stalled';

/** Payload shape for hook events. */
export interface HookEventPayload {
  event: HookEvent;
  entityType: 'feature' | 'packet' | 'wave' | 'approval' | 'run';
  entityId: string;
  featureId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ── Precondition (refusal detail atom) ──────────────────────────────

/**
 * One check in a precondition chain. When `met` is false,
 * `detail` explains why the action cannot proceed.
 */
export interface Precondition {
  check: string;      // human-readable description of what was checked
  met: boolean;       // whether the precondition is satisfied
  detail: string;     // specific detail about what was found
}

// ── Action availability verdict ─────────────────────────────────────

/**
 * Full availability report for a single operator action.
 * Includes all preconditions whether met or not,
 * so refusals carry explanations.
 */
export interface ActionAvailability {
  action: string;           // e.g. 'stop_run', 'retry_packet'
  available: boolean;       // all preconditions met
  reason: string;           // summary: why available or why not
  command: string | null;   // CLI command to execute if available
  preconditions: Precondition[];
  targetId: string;         // the entity this action targets
  targetType: ActionTargetType;
}

// ── Action execution result ─────────────────────────────────────────

/**
 * Outcome of attempting to execute an operator action.
 * On failure, `preconditions` explains why; on success, `auditId` links
 * to the durable audit record.
 */
export interface ActionResult {
  action: string;
  targetId: string;
  success: boolean;
  beforeState: string;
  afterState: string;
  message: string;
  error: string | null;
  auditId: string | null;
  preconditions: Precondition[];
}

// ── Next lawful action ──────────────────────────────────────────────

/** Priority level for the next-action recommendation. */
export type NextActionPriority = 'critical' | 'normal' | 'info';

/**
 * The single most important thing the operator should do right now.
 * Computed from run state + hook feed — never from operator input.
 */
export interface NextAction {
  action: string;       // Human-readable action description
  command: string | null; // CLI command to execute (null if just "wait")
  priority: NextActionPriority;
  reason: string;       // Why this is the next action
}

// ── Hook decision shapes ────────────────────────────────────────────

/**
 * A decision produced by the policy engine.
 * Combines the action with its target packets, role assignment,
 * and context-scoping bundle.
 */
export interface HookDecision {
  action: HookAction;
  packets: string[];
  role: string;
  model: string;
  playbookId: string;
  reason: string;
  requiresHumanApproval: boolean;
  contextBundle: {
    include: string[];
    exclude: string[];
  };
}

/**
 * A persisted hook decision log entry (row from hook_decisions table).
 */
export interface HookDecisionLog {
  id: string;
  timestamp: string;
  event: string;
  eventEntityId: string;
  featureId: string;
  conditionsJson: string;
  ruleMatched: string | null;
  action: string | null;
  packetsJson: string;
  mode: 'advisory' | 'autonomous';
  operatorDecision: OperatorDecision;
  executed: boolean;
  reason: string | null;
}

// ── Audit entry ─────────────────────────────────────────────────────

/**
 * A durable record of an operator action attempt.
 * Written on every executed action (success or failure).
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeState: string;
  afterState: string;
  reason: string;
  command: string;
  success: boolean;
  error: string | null;
}
