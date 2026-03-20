/**
 * Control Plane Monitor — Overview query.
 *
 * Computes a top-level snapshot of the entire control plane.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import type { RoutingStore } from '../../handoff/routing/routing-store.js';
import type { FlowStore } from '../../handoff/flow/flow-store.js';
import type { InterventionStore } from '../../handoff/intervention/intervention-store.js';
import type { PolicyStore } from '../../handoff/policy/policy-store.js';
import type { OutcomeStore } from '../../handoff/outcome/outcome-store.js';
import type { PromotionStore } from '../../handoff/promotion/promotion-store.js';
import { ALL_LANES } from '../../handoff/routing/types.js';
import { computeLaneState } from '../../handoff/flow/flow-actions.js';
import { deriveHealthSnapshot } from '../../handoff/intervention/intervention-actions.js';
import { nowISO } from '../../lib/ids.js';
import type { OverviewSnapshot, LaneHealthSummary } from '../types.js';
import { queryActivity } from './activity-query.js';

export interface OverviewStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
  routingStore: RoutingStore;
  flowStore: FlowStore;
  interventionStore: InterventionStore;
  policyStore: PolicyStore;
  outcomeStore: OutcomeStore;
  promotionStore: PromotionStore;
}

export function queryOverview(stores: OverviewStores): OverviewSnapshot {
  const {
    queueStore, supervisorStore, routingStore, flowStore,
    interventionStore, policyStore, outcomeStore, promotionStore,
  } = stores;

  // Queue counts
  const allItems = queueStore.listQueue();
  const pendingItems = allItems.filter(i => i.status === 'pending').length;
  const activeClaims = supervisorStore.listClaims({ activeOnly: true });
  const claimedItems = activeClaims.length;
  const deferredClaims = supervisorStore.listClaims().filter(c => c.status === 'deferred');
  const deferredItems = deferredClaims.length;

  // Outcomes
  const openOutcomes = outcomeStore.listOutcomes({ status: 'open' }).length;
  const closedOutcomes = outcomeStore.listOutcomes({ status: 'closed', limit: 1000 }).length;

  // Interventions
  const activeInterventions = interventionStore.listInterventions({ activeOnly: true }).length;

  // Trials
  const activeTrials = promotionStore.getActiveTrials();

  // Lane health
  const lanes: LaneHealthSummary[] = ALL_LANES.map(lane => {
    const capState = computeLaneState(flowStore, routingStore, supervisorStore, lane);
    const snapshot = deriveHealthSnapshot(flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane);
    const intervention = interventionStore.getActiveIntervention(lane);
    const overflowCount = flowStore.countOverflow(lane);

    return {
      lane,
      wipCap: capState.wipCap,
      activeCount: capState.activeCount,
      pendingCount: capState.pendingCount,
      overflowCount,
      starvedCount: 0, // derived on demand, not stored
      healthState: snapshot.healthState,
      hasIntervention: !!intervention,
      interventionAction: intervention?.action ?? null,
    };
  });

  // Active policy
  const activePolicy = policyStore.getActivePolicy();

  // Recent activity
  const recentActivity = queryActivity(stores, { limit: 20 });

  return {
    computedAt: nowISO(),
    counts: {
      pendingItems,
      claimedItems,
      deferredItems,
      totalActiveItems: allItems.filter(i => !['approved', 'rejected', 'completed', 'cancelled'].includes(i.status)).length,
      openOutcomes,
      closedOutcomes,
      activeInterventions,
      activeTrials: activeTrials.length,
    },
    lanes,
    recentActivity,
    activePolicy: {
      policySetId: activePolicy?.policySetId ?? null,
      version: activePolicy?.policyVersion ?? null,
      activatedAt: activePolicy?.activatedAt ?? null,
    },
    activeTrials: activeTrials.map(t => ({
      promotionId: t.promotionId,
      candidatePolicySetId: t.candidatePolicySetId,
      baselinePolicySetId: t.baselinePolicySetId,
      status: t.status,
      trialStartedAt: t.trialStartedAt,
      scope: t.scope,
    })),
  };
}
