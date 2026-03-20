/**
 * Client-side type definitions mirroring the server's monitor types.
 * These are pure data shapes — no imports from the server.
 */

// ── Shared enums (as string unions) ─────────────────────────────────

export type RoutingLane = 'reviewer' | 'approver' | 'recovery' | 'escalated_review';
export type HealthState = 'healthy' | 'degraded' | 'critical';
export type InterventionAction = 'pause_intake' | 'drain' | 'rebalance' | 'escalate';
export type BreachCode = 'wip_overflow' | 'starvation' | 'timeout' | 'error_rate';
export type PromotionStatus = 'candidate' | 'validated' | 'ready_for_trial' | 'trial_active' | 'trial_complete' | 'promoted' | 'rejected' | 'rolled_back';

// ── Overview ────────────────────────────────────────────────────────

export interface OverviewSnapshot {
  computedAt: string;
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
  lanes: LaneHealthSummary[];
  recentActivity: ActivityEvent[];
  activePolicy: {
    policySetId: string | null;
    version: number | null;
    activatedAt: string | null;
  };
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
  lane: RoutingLane | null;
  assignedTarget: string | null;
  claimant: string | null;
  claimStatus: string | null;
  leaseExpiresAt: string | null;
  isOverflow: boolean;
  isStarved: boolean;
  policySetId: string | null;
  createdAt: string;
  lastUpdatedAt: string;
  hasOutcome: boolean;
  outcomeStatus: string | null;
}

// ── Item Detail ─────────────────────────────────────────────────────

export interface ItemDetailView {
  queueItemId: string;
  handoffId: string;
  role: string;
  priorityClass: string;
  status: string;
  createdAt: string;
  handoffSummary: string | null;
  brief: {
    briefId: string;
    role: string;
    renderedText: string | null;
  } | null;
  blockers: Array<{
    code: string;
    severity: string;
    detail: string | null;
  }>;
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
  flow: {
    isOverflow: boolean;
    overflowSince: string | null;
  };
  intervention: {
    laneHealth: HealthState | null;
    activeIntervention: {
      interventionId: string;
      action: InterventionAction;
      reason: string;
      triggeredAt: string;
    } | null;
  };
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
  policy: {
    policySetId: string | null;
    policyVersion: number | null;
    isTrialPolicy: boolean;
    promotionId: string | null;
  };
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
  wipCap: number;
  activeCount: number;
  pendingCount: number;
  utilization: number;
  overflowCount: number;
  starvedCount: number;
  healthState: HealthState;
  breachCodes: BreachCode[];
  intervention: {
    interventionId: string;
    action: InterventionAction;
    reason: string;
    actor: string;
    triggeredAt: string;
  } | null;
  policyInputs: {
    wipCap: number;
    starvationThresholdMs: number;
    overflowThreshold: number;
  };
  trial: {
    promotionId: string;
    candidatePolicySetId: string;
    baselinePolicySetId: string;
    status: PromotionStatus;
  } | null;
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
