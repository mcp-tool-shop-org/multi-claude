/**
 * Control Plane Monitor — Read-optimized view types.
 *
 * These types project canonical truth from the law stores into
 * shapes optimized for UI consumption. They are read-only projections,
 * never sources of truth.
 */

import type { RoutingLane } from '../handoff/routing/types.js';
import type { HealthState, BreachCode, InterventionAction } from '../handoff/intervention/types.js';
import type { PromotionStatus } from '../handoff/promotion/types.js';
import type { DecisionAction } from '../handoff/decision/types.js';

// ── Overview ────────────────────────────────────────────────────────

export interface OverviewSnapshot {
  /** When this snapshot was computed */
  computedAt: string;

  /** Top-level counts */
  counts: {
    pendingItems: number;
    claimedItems: number;
    deferredItems: number;
    totalActiveItems: number;
    openOutcomes: number;
    closedOutcomes: number;
    activeInterventions: number;
    activeTrials: number;
  };

  /** Per-lane health summary */
  lanes: LaneHealthSummary[];

  /** Recent activity (last N events) */
  recentActivity: ActivityEvent[];

  /** Active policy info */
  activePolicy: {
    policySetId: string | null;
    version: number | null;
    activatedAt: string | null;
  };

  /** Active promotion trials */
  activeTrials: TrialSummary[];
}

export interface LaneHealthSummary {
  lane: RoutingLane;
  wipCap: number;
  activeCount: number;
  pendingCount: number;
  overflowCount: number;
  starvedCount: number;
  healthState: HealthState;
  hasIntervention: boolean;
  interventionAction: InterventionAction | null;
}

export interface TrialSummary {
  promotionId: string;
  candidatePolicySetId: string;
  baselinePolicySetId: string;
  status: PromotionStatus;
  trialStartedAt: string | null;
  scope: string;
}

// ── Queue List ──────────────────────────────────────────────────────

export interface QueueListItem {
  queueItemId: string;
  handoffId: string;
  role: string;
  priorityClass: string;
  status: string;

  /** Routing */
  lane: RoutingLane | null;
  assignedTarget: string | null;

  /** Supervisor */
  claimant: string | null;
  claimStatus: string | null;
  leaseExpiresAt: string | null;

  /** Flow */
  isOverflow: boolean;
  isStarved: boolean;

  /** Policy */
  policySetId: string | null;

  /** Timing */
  createdAt: string;
  lastUpdatedAt: string;

  /** Outcome */
  hasOutcome: boolean;
  outcomeStatus: string | null;

  /** Action eligibility */
  actions: ActionEligibility;
}

export interface QueueListFilters {
  lane?: RoutingLane;
  status?: string;
  claimed?: boolean;
  hasIntervention?: boolean;
  hasOutcome?: boolean;
  limit?: number;
}

// ── Item Detail ─────────────────────────────────────────────────────

export interface ItemDetailView {
  /** Core item */
  queueItemId: string;
  handoffId: string;
  role: string;
  priorityClass: string;
  status: string;
  createdAt: string;

  /** Handoff summary */
  handoffSummary: string | null;

  /** Decision brief */
  brief: {
    briefId: string;
    role: string;
    renderedText: string | null;
  } | null;

  /** Blockers */
  blockers: Array<{
    code: string;
    severity: string;
    detail: string | null;
  }>;

  /** Routing state */
  routing: {
    currentLane: RoutingLane | null;
    assignedTarget: string | null;
    routeHistory: Array<{
      routeId: string;
      lane: RoutingLane;
      status: string;
      reasonCode: string;
      routedAt: string;
    }>;
  };

  /** Supervisor state */
  supervisor: {
    activeClaim: {
      claimId: string;
      actor: string;
      status: string;
      claimedAt: string;
      expiresAt: string;
    } | null;
    claimHistory: Array<{
      claimId: string;
      actor: string;
      status: string;
      claimedAt: string;
    }>;
  };

  /** Flow state */
  flow: {
    isOverflow: boolean;
    overflowSince: string | null;
  };

  /** Intervention state */
  intervention: {
    laneHealth: HealthState | null;
    activeIntervention: {
      interventionId: string;
      action: InterventionAction;
      reason: string;
      triggeredAt: string;
    } | null;
  };

  /** Outcome (if closed) */
  outcome: {
    outcomeId: string;
    status: string;
    finalAction: string | null;
    resolutionQuality: string | null;
    durationMs: number | null;
    claimCount: number;
    deferCount: number;
    rerouteCount: number;
    escalationCount: number;
    closedAt: string | null;
  } | null;

  /** Policy context */
  policy: {
    policySetId: string | null;
    policyVersion: number | null;
    isTrialPolicy: boolean;
    promotionId: string | null;
  };

  /** Action eligibility */
  actions: ActionEligibility;

  /** Decision Workbench — full brief projection for judgment surface */
  workbench: BriefWorkbenchView | null;

  /** Decision affordance — operator-gated decision state */
  decisionAffordance: DecisionAffordance;

  /** Event timeline (unified, chronological) */
  timeline: TimelineEvent[];
}

export interface TimelineEvent {
  timestamp: string;
  source: 'queue' | 'supervisor' | 'routing' | 'flow' | 'intervention' | 'policy' | 'outcome' | 'promotion';
  kind: string;
  detail: string;
  actor: string | null;
}

// ── Lane Health ─────────────────────────────────────────────────────

export interface LaneHealthView {
  lane: RoutingLane;

  /** Capacity */
  wipCap: number;
  activeCount: number;
  pendingCount: number;
  utilization: number; // activeCount / wipCap

  /** Pressure */
  overflowCount: number;
  starvedCount: number;

  /** Health */
  healthState: HealthState;
  breachCodes: BreachCode[];

  /** Active intervention */
  intervention: {
    interventionId: string;
    action: InterventionAction;
    reason: string;
    actor: string;
    triggeredAt: string;
  } | null;

  /** Policy inputs for this lane */
  policyInputs: {
    wipCap: number;
    starvationThresholdMs: number;
    overflowThreshold: number;
  };

  /** Trial state */
  trial: {
    promotionId: string;
    candidatePolicySetId: string;
    baselinePolicySetId: string;
    status: PromotionStatus;
  } | null;

  /** Recent lane events */
  recentEvents: ActivityEvent[];
}

// ── Activity Timeline ───────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  timestamp: string;
  source: 'queue' | 'supervisor' | 'routing' | 'flow' | 'intervention' | 'policy' | 'outcome' | 'promotion';
  kind: string;
  lane: RoutingLane | null;
  queueItemId: string | null;
  actor: string | null;
  detail: string;
}

export interface ActivityFilters {
  source?: ActivityEvent['source'];
  lane?: RoutingLane;
  limit?: number;
  since?: string;
}

// ── Decision Workbench (Phase 13C) ─────────────────────────────────

export interface BriefWorkbenchView {
  briefId: string;
  role: 'reviewer' | 'approver';
  handoffId: string;
  packetVersion: number;
  baselinePacketVersion: number | null;
  briefVersion: string;
  createdAt: string;
  summary: string;
  deltaSummary: string[];
  blockers: Array<{ code: string; severity: string; summary: string }>;
  evidenceCoverage: {
    fingerprint: string;
    requiredArtifacts: string[];
    presentArtifacts: string[];
    missingArtifacts: string[];
  };
  eligibility: {
    allowedActions: DecisionAction[];
    recommendedAction: DecisionAction;
    rationale: string[];
  };
  risks: string[];
  openLoops: string[];
  decisionRefs: string[];
}

/**
 * Decision affordance — separates "what the brief allows"
 * from "what the current operator/session state allows."
 */
export interface DecisionAffordance {
  /** Whether decision actions can be taken right now */
  decisionEnabled: boolean;
  /** Why decisions are disabled, if they are */
  disabledReason: string | null;
  /** Whether any operator has an active claim */
  hasActiveClaim: boolean;
  /** Whether the current operator holds the claim (always true for simple 13C identity) */
  claimedByOperator: boolean;
}

export interface DecisionRequest {
  operatorId: string;
  action: DecisionAction;
  reason: string;
}

export interface DecisionCommandResponse {
  ok: boolean;
  action: string;
  queueItemId: string;
  actionId?: string;
  newStatus?: string;
  error?: {
    code: string;
    message: string;
  };
}

// ── Action Eligibility ──────────────────────────────────────────────

export type OperatorAction = 'claim' | 'release' | 'defer' | 'requeue' | 'escalate';

export interface ActionEligibilityEntry {
  allowed: boolean;
  reason?: string;
}

export type ActionEligibility = Record<OperatorAction, ActionEligibilityEntry>;

// ── Command Types ──────────────────────────────────────────────────

export interface ClaimItemRequest {
  operatorId: string;
}

export interface ReleaseItemRequest {
  operatorId: string;
  reason?: string;
}

export interface DeferItemRequest {
  operatorId: string;
  reason: string;
  until?: string; // ISO timestamp
}

export interface RequeueItemRequest {
  operatorId: string;
  reason?: string;
}

export interface EscalateItemRequest {
  operatorId: string;
  reason: string;
  target?: string;
}

export interface MonitorCommandResponse {
  ok: boolean;
  action: OperatorAction;
  queueItemId: string;
  eventId?: string;
  updatedItem?: ItemDetailView;
  error?: {
    code: string;
    message: string;
  };
}

// ── Outcome List ────────────────────────────────────────────────────

export interface OutcomeListItem {
  outcomeId: string;
  queueItemId: string;
  status: string;
  finalAction: string | null;
  resolutionQuality: string | null;
  durationMs: number | null;
  claimCount: number;
  interventionCount: number;
  policySetId: string | null;
  isTrialOutcome: boolean;
  openedAt: string;
  closedAt: string | null;
}
