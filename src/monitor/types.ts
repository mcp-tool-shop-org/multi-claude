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
