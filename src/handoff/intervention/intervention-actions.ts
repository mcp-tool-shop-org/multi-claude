/**
 * Intervention Law — Actions.
 *
 * Handles:
 *   - Health snapshot derivation from control-plane state
 *   - Breach detection (deterministic threshold rules)
 *   - Intervention actions (freeze, restrict, escalate, force-recovery)
 *   - Resolution / recovery paths
 *   - Admission/claim checks against active interventions
 *
 * Law: unhealthy states are explicit, interventions are bounded,
 * and every transition is audited.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { RoutingLane } from '../routing/types.js';
import { ALL_LANES } from '../routing/types.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { FlowStore } from '../flow/flow-store.js';
import {
  computeLaneState,
  detectStarvation,
} from '../flow/flow-actions.js';
import type { InterventionStore } from './intervention-store.js';
import type {
  HealthState,
  BreachCode,
  HealthSnapshot,
  Intervention,
  InterventionAction,
  BreachThresholds,
} from './types.js';
import { DEFAULT_BREACH_THRESHOLDS } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Health snapshot derivation ──────────────────────────────────────

/**
 * Derive a health snapshot for a single lane from current control-plane state.
 */
export function deriveHealthSnapshot(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  lane: RoutingLane,
  thresholds: BreachThresholds = DEFAULT_BREACH_THRESHOLDS,
): HealthSnapshot {
  const laneState = computeLaneState(flowStore, routingStore, supervisorStore, lane);
  const starved = detectStarvation(queueStore, routingStore, supervisorStore, 0)
    .filter(s => s.lane === lane);

  // Check for active freeze
  const activeIntervention = interventionStore.getActiveIntervention(lane);
  if (activeIntervention?.action === 'freeze') {
    return {
      snapshotId: generateId('hs'),
      lane,
      healthState: 'frozen',
      breachCodes: activeIntervention.breachCodes,
      activeCount: laneState.activeCount,
      pendingCount: laneState.pendingCount,
      overflowCount: laneState.overflowCount,
      starvedCount: starved.length,
      wipCap: laneState.wipCap,
      createdAt: nowISO(),
    };
  }

  // Detect breaches
  const breachCodes = detectBreaches(
    flowStore, interventionStore, lane, laneState, starved.length, thresholds,
  );

  // Derive health state
  let healthState: HealthState;
  if (activeIntervention?.action === 'restrict') {
    healthState = 'degraded';
  } else if (breachCodes.length > 0) {
    healthState = 'breached';
  } else if (
    laneState.activeCount >= laneState.wipCap * 0.8 ||
    laneState.overflowCount > 0 ||
    starved.length > 0
  ) {
    healthState = 'pressured';
  } else {
    healthState = 'healthy';
  }

  return {
    snapshotId: generateId('hs'),
    lane,
    healthState,
    breachCodes,
    activeCount: laneState.activeCount,
    pendingCount: laneState.pendingCount,
    overflowCount: laneState.overflowCount,
    starvedCount: starved.length,
    wipCap: laneState.wipCap,
    createdAt: nowISO(),
  };
}

/**
 * Derive health snapshots for all lanes.
 */
export function deriveAllHealthSnapshots(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  thresholds?: BreachThresholds,
): HealthSnapshot[] {
  return ALL_LANES.map(lane =>
    deriveHealthSnapshot(flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane, thresholds),
  );
}

// ── Breach detection ────────────────────────────────────────────────

/**
 * Detect active breach conditions for a lane.
 * Returns an array of breach codes.
 */
function detectBreaches(
  flowStore: FlowStore,
  _interventionStore: InterventionStore,
  lane: RoutingLane,
  laneState: ReturnType<typeof computeLaneState>,
  starvedCount: number,
  thresholds: BreachThresholds,
): BreachCode[] {
  const codes: BreachCode[] = [];

  // Prolonged saturation: lane at cap
  if (laneState.activeCount >= laneState.wipCap) {
    // Check how many consecutive saturation snapshots exist
    // For simplicity, we check recent flow events for sustained saturation
    const recentEvents = flowStore.getEvents({ lane, kind: 'admission_denied', limit: thresholds.saturationChecks });
    if (recentEvents.length >= thresholds.saturationChecks) {
      codes.push('prolonged_saturation');
    }
  }

  // Repeated starvation
  if (starvedCount >= thresholds.starvationCount) {
    codes.push('repeated_starvation');
  }

  // Overflow backlog
  if (laneState.overflowCount >= thresholds.overflowBacklog) {
    codes.push('overflow_backlog');
  }

  // Recovery storm (recovery lane only)
  if (lane === 'recovery') {
    const recoveryEvents = flowStore.getEvents({ lane: 'recovery', limit: thresholds.recoveryStormEvents * 2 });
    const throttleCount = recoveryEvents.filter(e => e.reasonCode === 'recovery_throttle').length;
    if (throttleCount >= thresholds.recoveryStormEvents) {
      codes.push('recovery_storm');
    }
  }

  // Claim churn: many expired claims
  const expiredEvents = flowStore.getEvents({ lane, kind: 'capacity_freed', limit: thresholds.claimChurnEvents * 2 });
  const churnCount = expiredEvents.filter(e => e.reasonCode === 'claim_expired').length;
  if (churnCount >= thresholds.claimChurnEvents) {
    codes.push('claim_churn');
  }

  return codes;
}

// ── Intervention actions ────────────────────────────────────────────

export interface InterventionResult {
  ok: true;
  intervention: Intervention;
  snapshot: HealthSnapshot;
}

export interface InterventionError {
  ok: false;
  error: string;
  code: 'already_intervened' | 'invalid_action' | 'not_found' | 'already_resolved' | 'no_active_intervention';
}

/**
 * Start an intervention on a lane.
 */
export function startIntervention(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  input: {
    lane: RoutingLane;
    action: InterventionAction;
    reason: string;
    actor: string;
    breachCodes?: BreachCode[];
  },
): InterventionResult | InterventionError {
  const { lane, action, reason, actor, breachCodes = [] } = input;

  // Check for existing active intervention
  const existing = interventionStore.getActiveIntervention(lane);
  if (existing) {
    return {
      ok: false,
      error: `Lane '${lane}' already has active intervention '${existing.action}'`,
      code: 'already_intervened',
    };
  }

  const now = nowISO();

  // Get prior health state
  const priorSnapshot = interventionStore.getLatestSnapshot(lane);
  const fromState: HealthState = priorSnapshot?.healthState ?? 'healthy';

  // Determine new health state based on action
  let toState: HealthState;
  switch (action) {
    case 'freeze': toState = 'frozen'; break;
    case 'restrict': toState = 'degraded'; break;
    default: toState = 'breached'; break;
  }

  // Create intervention
  const intervention: Intervention = {
    interventionId: generateId('iv'),
    lane,
    action,
    status: 'active',
    breachCodes,
    reason,
    actor,
    triggeredAt: now,
    resolvedAt: null,
    resolvedBy: null,
    resolveReason: null,
  };

  interventionStore.insertIntervention(intervention);

  // Take snapshot
  const snapshot = deriveHealthSnapshot(
    flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane,
  );
  // Override health state to match the intervention
  snapshot.healthState = toState;
  interventionStore.insertSnapshot(snapshot);

  // Record event
  interventionStore.insertEvent({
    interventionId: intervention.interventionId,
    lane,
    kind: 'intervention_started',
    fromState,
    toState,
    breachCodes,
    action,
    reasonCode: actor === 'system' ? 'breach_trigger' : 'manual_intervention',
    reason,
    actor,
    createdAt: now,
  });

  // Record specific event for freeze/restrict
  if (action === 'freeze') {
    interventionStore.insertEvent({
      interventionId: intervention.interventionId,
      lane,
      kind: 'freeze_applied',
      fromState,
      toState: 'frozen',
      breachCodes,
      action: 'freeze',
      reasonCode: 'freeze_ordered',
      reason,
      actor,
      createdAt: now,
    });
  } else if (action === 'restrict') {
    interventionStore.insertEvent({
      interventionId: intervention.interventionId,
      lane,
      kind: 'restriction_applied',
      fromState,
      toState: 'degraded',
      breachCodes,
      action: 'restrict',
      reasonCode: 'manual_intervention',
      reason,
      actor,
      createdAt: now,
    });
  }

  return { ok: true, intervention, snapshot };
}

/**
 * Resolve an active intervention on a lane.
 */
export function resolveIntervention(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  input: {
    lane: RoutingLane;
    actor: string;
    reason: string;
  },
): InterventionResult | InterventionError {
  const { lane, actor, reason } = input;

  const active = interventionStore.getActiveIntervention(lane);
  if (!active) {
    return {
      ok: false,
      error: `No active intervention on lane '${lane}'`,
      code: 'no_active_intervention',
    };
  }

  const now = nowISO();
  const priorSnapshot = interventionStore.getLatestSnapshot(lane);
  const fromState: HealthState = priorSnapshot?.healthState ?? active.action === 'freeze' ? 'frozen' : 'degraded';

  // Resolve the intervention
  interventionStore.resolveIntervention(active.interventionId, actor, reason, now);

  // Take fresh snapshot after resolution
  const snapshot = deriveHealthSnapshot(
    flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane,
  );
  interventionStore.insertSnapshot(snapshot);

  // Record event
  interventionStore.insertEvent({
    interventionId: active.interventionId,
    lane,
    kind: 'intervention_resolved',
    fromState,
    toState: snapshot.healthState,
    breachCodes: active.breachCodes,
    action: active.action,
    reasonCode: 'manual_resolve',
    reason,
    actor,
    createdAt: now,
  });

  // Record specific unfreeze/unrestrict event
  if (active.action === 'freeze') {
    interventionStore.insertEvent({
      interventionId: active.interventionId,
      lane,
      kind: 'freeze_lifted',
      fromState: 'frozen',
      toState: snapshot.healthState,
      breachCodes: [],
      action: null,
      reasonCode: 'unfreeze_ordered',
      reason,
      actor,
      createdAt: now,
    });
  } else if (active.action === 'restrict') {
    interventionStore.insertEvent({
      interventionId: active.interventionId,
      lane,
      kind: 'restriction_lifted',
      fromState: 'degraded',
      toState: snapshot.healthState,
      breachCodes: [],
      action: null,
      reasonCode: 'manual_resolve',
      reason,
      actor,
      createdAt: now,
    });
  }

  // Return updated intervention
  const resolved = interventionStore.getIntervention(active.interventionId)!;
  return { ok: true, intervention: resolved, snapshot };
}

// ── Admission/claim checks ──────────────────────────────────────────

export interface InterventionCheck {
  allowed: true;
}

export interface InterventionBlocked {
  allowed: false;
  reason: string;
  interventionId: string;
  action: InterventionAction;
}

/**
 * Check if a lane allows new claims (respects freeze/restrict).
 */
export function checkInterventionForClaim(
  interventionStore: InterventionStore,
  lane: RoutingLane,
): InterventionCheck | InterventionBlocked {
  const active = interventionStore.getActiveIntervention(lane);
  if (!active) return { allowed: true };

  if (active.action === 'freeze') {
    return {
      allowed: false,
      reason: `Lane '${lane}' is frozen: ${active.reason}`,
      interventionId: active.interventionId,
      action: 'freeze',
    };
  }

  // Restrict doesn't block claims on existing work, just new admissions
  return { allowed: true };
}

/**
 * Check if a lane allows new admissions (respects freeze AND restrict).
 */
export function checkInterventionForAdmission(
  interventionStore: InterventionStore,
  lane: RoutingLane,
): InterventionCheck | InterventionBlocked {
  const active = interventionStore.getActiveIntervention(lane);
  if (!active) return { allowed: true };

  if (active.action === 'freeze' || active.action === 'restrict') {
    return {
      allowed: false,
      reason: `Lane '${lane}' is ${active.action === 'freeze' ? 'frozen' : 'restricted'}: ${active.reason}`,
      interventionId: active.interventionId,
      action: active.action,
    };
  }

  return { allowed: true };
}
