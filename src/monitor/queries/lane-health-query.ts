/**
 * Control Plane Monitor — Lane health query.
 *
 * Per-lane operational state with capacity, pressure, and intervention detail.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import type { RoutingStore } from '../../handoff/routing/routing-store.js';
import type { FlowStore } from '../../handoff/flow/flow-store.js';
import type { InterventionStore } from '../../handoff/intervention/intervention-store.js';
import type { PolicyStore } from '../../handoff/policy/policy-store.js';
import type { PromotionStore } from '../../handoff/promotion/promotion-store.js';
import type { RoutingLane } from '../../handoff/routing/types.js';
import { ALL_LANES } from '../../handoff/routing/types.js';
import { computeLaneState } from '../../handoff/flow/flow-actions.js';
import { deriveHealthSnapshot } from '../../handoff/intervention/intervention-actions.js';
import { resolveActivePolicy } from '../../handoff/policy/policy-actions.js';
import type { LaneHealthView, ActivityEvent } from '../types.js';

export interface LaneHealthStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
  routingStore: RoutingStore;
  flowStore: FlowStore;
  interventionStore: InterventionStore;
  policyStore: PolicyStore;
  promotionStore: PromotionStore;
}

export function queryLaneHealth(
  stores: LaneHealthStores,
  lane: RoutingLane,
): LaneHealthView {
  const {
    queueStore, supervisorStore, routingStore, flowStore,
    interventionStore, policyStore, promotionStore,
  } = stores;

  // Capacity state
  const capState = computeLaneState(flowStore, routingStore, supervisorStore, lane);

  // Health snapshot
  const snapshot = deriveHealthSnapshot(
    flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane,
  );

  // Active intervention
  const intervention = interventionStore.getActiveIntervention(lane);

  // Overflow count
  const overflowCount = flowStore.countOverflow(lane);

  // Policy inputs
  const activePolicy = resolveActivePolicy(policyStore);

  // Active trial
  const activeTrials = promotionStore.getActiveTrials();
  const trial = activeTrials.length > 0 ? activeTrials[0]! : null;

  // Recent lane events
  const flowEvents = flowStore.getEvents({ lane, limit: 10 });
  const interventionEvents = interventionStore.getEvents({ lane, limit: 10 });

  const recentEvents: ActivityEvent[] = [];
  for (const e of flowEvents) {
    recentEvents.push({
      id: `flow-${e.lane}-${e.createdAt}`,
      timestamp: e.createdAt,
      source: 'flow',
      kind: e.kind,
      lane: e.lane,
      queueItemId: e.queueItemId ?? null,
      actor: null,
      detail: `${e.kind}: ${e.reason ?? e.reasonCode}`,
    });
  }
  for (const e of interventionEvents) {
    recentEvents.push({
      id: `intervention-${e.lane}-${e.createdAt}`,
      timestamp: e.createdAt,
      source: 'intervention',
      kind: e.kind,
      lane: e.lane,
      queueItemId: null,
      actor: e.actor,
      detail: `${e.kind}: ${e.reason}`,
    });
  }
  recentEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    lane,
    wipCap: capState.wipCap,
    activeCount: capState.activeCount,
    pendingCount: capState.pendingCount,
    utilization: capState.wipCap > 0 ? capState.activeCount / capState.wipCap : 0,
    overflowCount,
    starvedCount: 0,
    healthState: snapshot.healthState,
    breachCodes: snapshot.breachCodes,
    intervention: intervention ? {
      interventionId: intervention.interventionId,
      action: intervention.action,
      reason: intervention.reason,
      actor: intervention.actor,
      triggeredAt: intervention.triggeredAt,
    } : null,
    policyInputs: {
      wipCap: activePolicy.content.laneCaps[lane] ?? capState.wipCap,
      starvationThresholdMs: activePolicy.content.starvationThresholdMs[lane] ?? 0,
      overflowThreshold: activePolicy.content.overflowThreshold[lane] ?? 0,
    },
    trial: trial ? {
      promotionId: trial.promotionId,
      candidatePolicySetId: trial.candidatePolicySetId,
      baselinePolicySetId: trial.baselinePolicySetId,
      status: trial.status,
    } : null,
    recentEvents: recentEvents.slice(0, 15),
  };
}

export function queryAllLaneHealth(stores: LaneHealthStores): LaneHealthView[] {
  return ALL_LANES.map(lane => queryLaneHealth(stores, lane));
}
