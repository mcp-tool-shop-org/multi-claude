/**
 * Control Plane Monitor — Activity timeline query.
 *
 * Aggregates recent events across all control plane subsystems
 * into a unified chronological feed.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import type { RoutingStore } from '../../handoff/routing/routing-store.js';
import type { FlowStore } from '../../handoff/flow/flow-store.js';
import type { InterventionStore } from '../../handoff/intervention/intervention-store.js';
import type { PolicyStore } from '../../handoff/policy/policy-store.js';
import type { OutcomeStore } from '../../handoff/outcome/outcome-store.js';
import type { PromotionStore } from '../../handoff/promotion/promotion-store.js';
import type { ActivityEvent, ActivityFilters } from '../types.js';
import type { RoutingLane } from '../../handoff/routing/types.js';

export interface ActivityStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
  routingStore: RoutingStore;
  flowStore: FlowStore;
  interventionStore: InterventionStore;
  policyStore: PolicyStore;
  outcomeStore: OutcomeStore;
  promotionStore: PromotionStore;
}

export function queryActivity(
  stores: ActivityStores,
  filters?: ActivityFilters,
): ActivityEvent[] {
  const limit = filters?.limit ?? 50;
  const events: ActivityEvent[] = [];

  // Supervisor events (claims, releases, defers, escalations)
  if (!filters?.source || filters.source === 'supervisor') {
    const claims = stores.supervisorStore.listClaims();
    for (const claim of claims.slice(0, limit)) {
      const claimEvents = stores.supervisorStore.getEvents(claim.claimId);
      for (const e of claimEvents) {
        events.push({
          id: `sv-${claim.claimId}-${e.kind}-${e.createdAt}`,
          timestamp: e.createdAt,
          source: 'supervisor',
          kind: e.kind,
          lane: null,
          queueItemId: claim.queueItemId,
          actor: e.actor,
          detail: `${e.kind}: ${e.reason ?? `${e.fromStatus ?? '∅'} → ${e.toStatus}`}`,
        });
      }
    }
  }

  // Flow events
  if (!filters?.source || filters.source === 'flow') {
    const flowEvents = stores.flowStore.getEvents({
      lane: filters?.lane,
      limit: limit * 2,
    });
    for (const e of flowEvents) {
      events.push({
        id: `flow-${e.lane}-${e.kind}-${e.createdAt}`,
        timestamp: e.createdAt,
        source: 'flow',
        kind: e.kind,
        lane: e.lane as RoutingLane,
        queueItemId: e.queueItemId ?? null,
        actor: null,
        detail: `${e.kind}: ${e.reason ?? e.reasonCode}`,
      });
    }
  }

  // Intervention events
  if (!filters?.source || filters.source === 'intervention') {
    const interventionEvents = stores.interventionStore.getEvents({
      lane: filters?.lane,
      limit: limit * 2,
    });
    for (const e of interventionEvents) {
      events.push({
        id: `int-${e.lane}-${e.kind}-${e.createdAt}`,
        timestamp: e.createdAt,
        source: 'intervention',
        kind: e.kind,
        lane: e.lane as RoutingLane,
        queueItemId: null,
        actor: e.actor,
        detail: `${e.kind}: ${e.reason}`,
      });
    }
  }

  // Policy events
  if (!filters?.source || filters.source === 'policy') {
    const policyEvents = stores.policyStore.getEvents({ limit: limit });
    for (const e of policyEvents) {
      events.push({
        id: `pol-${e.policySetId}-${e.kind}-${e.createdAt}`,
        timestamp: e.createdAt,
        source: 'policy',
        kind: e.kind,
        lane: null,
        queueItemId: null,
        actor: e.actor,
        detail: `${e.kind}: ${e.reason}`,
      });
    }
  }

  // Promotion events
  if (!filters?.source || filters.source === 'promotion') {
    const promotions = stores.promotionStore.listPromotions({ limit: 10 });
    for (const promo of promotions) {
      const promoEvents = stores.promotionStore.getEvents(promo.promotionId);
      for (const e of promoEvents) {
        events.push({
          id: `promo-${promo.promotionId}-${e.kind}-${e.createdAt}`,
          timestamp: e.createdAt,
          source: 'promotion',
          kind: e.kind,
          lane: null,
          queueItemId: null,
          actor: e.actor,
          detail: `${e.kind}: ${e.reason}`,
        });
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply since filter
  let filtered = events;
  if (filters?.since) {
    filtered = filtered.filter(e => e.timestamp >= filters.since!);
  }

  return filtered.slice(0, limit);
}
