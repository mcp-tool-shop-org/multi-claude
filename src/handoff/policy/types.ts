/**
 * Policy Control — Types.
 *
 * Versioned, validated, activatable policy sets that govern
 * routing, flow, intervention, and supervisor behavior.
 *
 * Law: the control plane's rules are explicit, versioned,
 * and every runtime decision binds to a policy version.
 */

import type { RoutingLane } from '../routing/types.js';
import type { BreachThresholds } from '../intervention/types.js';

// ── Policy set status ───────────────────────────────────────────────

export type PolicyStatus =
  | 'draft'         // created but not validated
  | 'validated'     // passed validation
  | 'active'        // currently governing runtime decisions
  | 'superseded'    // replaced by a newer active policy
  | 'rolled_back';  // explicitly rolled back

// ── Policy content ──────────────────────────────────────────────────

/**
 * The canonical policy content — source of truth for all thresholds,
 * caps, and behavioral rules.
 */
export interface PolicyContent {
  /** Per-lane WIP caps */
  laneCaps: Record<RoutingLane, number>;

  /** Per-lane starvation threshold in milliseconds */
  starvationThresholdMs: Record<RoutingLane, number>;

  /** Per-lane overflow backlog threshold */
  overflowThreshold: Record<RoutingLane, number>;

  /** Recovery throttle limit */
  recoveryThrottle: number;

  /** Breach detection thresholds */
  breachThresholds: BreachThresholds;

  /** Default routing targets per lane (null = first-available) */
  routingDefaults: Record<RoutingLane, string | null>;

  /** Default escalation target */
  escalationTarget: string | null;

  /** Default lease duration in milliseconds */
  leaseDurationMs: number;

  /** Defer resurface check interval in milliseconds */
  deferResurfaceIntervalMs: number;
}

// ── Policy set ──────────────────────────────────────────────────────

export interface PolicySet {
  policySetId: string;
  policyVersion: number;
  status: PolicyStatus;
  scope: string;               // e.g. 'global' or a specific project
  content: PolicyContent;
  contentHash: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
}

// ── Policy events ───────────────────────────────────────────────────

export interface PolicyEvent {
  policySetId: string;
  kind: PolicyEventKind;
  fromStatus: PolicyStatus | null;
  toStatus: PolicyStatus;
  reason: string;
  actor: string;
  createdAt: string;
}

export type PolicyEventKind =
  | 'created'
  | 'validated'
  | 'activated'
  | 'superseded'
  | 'rolled_back'
  | 'simulated';

// ── Validation ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: true;
}

export interface ValidationError {
  valid: false;
  errors: string[];
}

// ── Simulation ──────────────────────────────────────────────────────

export interface PolicyDiff {
  field: string;
  lane?: RoutingLane;
  oldValue: unknown;
  newValue: unknown;
}

export interface SimulationResult {
  diffs: PolicyDiff[];
  impactSummary: string[];
}

// ── Default policy ──────────────────────────────────────────────────

export const DEFAULT_POLICY_CONTENT: PolicyContent = {
  laneCaps: {
    reviewer: 5,
    approver: 5,
    recovery: 5,
    escalated_review: 5,
  },
  starvationThresholdMs: {
    reviewer: 4 * 60 * 60 * 1000,
    approver: 4 * 60 * 60 * 1000,
    recovery: 2 * 60 * 60 * 1000,
    escalated_review: 1 * 60 * 60 * 1000,
  },
  overflowThreshold: {
    reviewer: 5,
    approver: 5,
    recovery: 3,
    escalated_review: 3,
  },
  recoveryThrottle: 3,
  breachThresholds: {
    saturationChecks: 3,
    starvationCount: 3,
    overflowBacklog: 5,
    recoveryStormEvents: 5,
    claimChurnEvents: 5,
  },
  routingDefaults: {
    reviewer: null,
    approver: null,
    recovery: 'recovery-worker',
    escalated_review: null,
  },
  escalationTarget: null,
  leaseDurationMs: 15 * 60 * 1000,
  deferResurfaceIntervalMs: 5 * 60 * 1000,
};
