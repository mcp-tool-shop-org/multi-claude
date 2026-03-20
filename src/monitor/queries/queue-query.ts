/**
 * Control Plane Monitor — Queue query.
 *
 * Projects queue items with routing, claim, flow, and outcome state joined.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import type { RoutingStore } from '../../handoff/routing/routing-store.js';
import type { FlowStore } from '../../handoff/flow/flow-store.js';
import type { OutcomeStore } from '../../handoff/outcome/outcome-store.js';
import type { QueueListItem, QueueListFilters } from '../types.js';
import { computeEligibility } from '../policies/action-eligibility.js';

export interface QueueQueryStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
  routingStore: RoutingStore;
  flowStore: FlowStore;
  outcomeStore: OutcomeStore;
}

export function queryQueueList(
  stores: QueueQueryStores,
  filters?: QueueListFilters,
): QueueListItem[] {
  const { queueStore, supervisorStore, routingStore, flowStore, outcomeStore } = stores;

  let items = queueStore.listQueue();

  // Apply status filter
  if (filters?.status) {
    items = items.filter(i => i.status === filters.status);
  }

  // Apply outcome filter
  if (filters?.hasOutcome !== undefined) {
    items = items.filter(i => {
      const outcome = outcomeStore.getOutcomeByQueueItem(i.queueItemId);
      return filters.hasOutcome ? !!outcome : !outcome;
    });
  }

  // Map to projected shapes
  let result: QueueListItem[] = items.map(item => {
    const route = routingStore.getActiveRoute(item.queueItemId);
    const claim = supervisorStore.getActiveClaim(item.queueItemId);
    const overflow = flowStore.getOverflow(item.queueItemId);
    const outcome = outcomeStore.getOutcomeByQueueItem(item.queueItemId);

    // Determine last updated time from events
    const events = queueStore.getEvents(item.queueItemId);
    const lastEvent = events[events.length - 1];

    return {
      queueItemId: item.queueItemId,
      handoffId: item.handoffId,
      role: item.role,
      priorityClass: item.priorityClass,
      status: item.status,

      lane: route?.lane ?? null,
      assignedTarget: route?.assignedTarget ?? null,

      claimant: claim?.claimedBy ?? null,
      claimStatus: claim?.status ?? null,
      leaseExpiresAt: claim?.leaseExpiresAt ?? null,

      isOverflow: !!overflow,
      isStarved: false, // computed on demand

      policySetId: outcome?.policySetId ?? null,

      createdAt: item.createdAt,
      lastUpdatedAt: lastEvent?.createdAt ?? item.createdAt,

      hasOutcome: !!outcome,
      outcomeStatus: outcome?.status ?? null,

      actions: computeEligibility({ queueStore, supervisorStore }, item.queueItemId),
    };
  });

  // Apply lane filter (needs route data, so applied post-projection)
  if (filters?.lane) {
    result = result.filter(r => r.lane === filters.lane);
  }

  // Apply claimed filter
  if (filters?.claimed !== undefined) {
    result = result.filter(r => filters.claimed ? !!r.claimant : !r.claimant);
  }

  // Apply limit
  if (filters?.limit) {
    result = result.slice(0, filters.limit);
  }

  return result;
}
