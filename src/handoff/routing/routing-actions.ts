/**
 * Routing Law — Actions and transitions.
 *
 * Handles:
 *   - Initial lane derivation from brief/queue state
 *   - Default assignment policy
 *   - Reroute: recovery, approval-ready, escalation, manual
 *   - Aging/resurfacing for deferred and escalated items
 *   - Staleness/invalidation interruption of active routes
 *
 * Law: one active route per queue item at a time.
 * Lane transitions are explicit, audited, and deterministic.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { QueueItem } from '../queue/types.js';
import { TERMINAL_STATUSES } from '../queue/types.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from './routing-store.js';
import type { Route, RoutingLane, RoutingReasonCode } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Result types ────────────────────────────────────────────────────

export interface RouteResult {
  ok: true;
  route: Route;
}

export interface RoutingError {
  ok: false;
  error: string;
  code: 'item_not_found' | 'item_terminal' | 'already_routed' | 'route_not_found'
    | 'same_lane' | 'no_active_route';
}

// ── Lane resolver ───────────────────────────────────────────────────

/**
 * Deterministic lane resolution from queue item state.
 *
 * Rules:
 *   - recovery_needed priority → recovery lane
 *   - approver role + approvable priority → approver lane
 *   - reviewer role → reviewer lane
 *   - approver role + blocked → reviewer lane (needs review first)
 */
export function resolveLane(item: QueueItem): RoutingLane {
  // Recovery-needed items always go to recovery
  if (item.priorityClass === 'recovery_needed') {
    return 'recovery';
  }

  // Approver items that are approvable go to approver lane
  if (item.role === 'approver' && item.priorityClass === 'approvable') {
    return 'approver';
  }

  // Approver items that are blocked need reviewer first
  if (item.role === 'approver' && (item.priorityClass === 'blocked_high' || item.priorityClass === 'blocked_medium')) {
    return 'reviewer';
  }

  // Default: reviewer lane
  return 'reviewer';
}

/**
 * Deterministic default assignment based on lane and item state.
 *
 * Returns a target string or null if no default assignment applies.
 * This is policy, not AI — the target is derived from structured state.
 */
export function resolveDefaultTarget(_item: QueueItem, lane: RoutingLane): string | null {
  // Recovery lane items can target the original worker/role
  if (lane === 'recovery') {
    return 'recovery-worker';
  }

  // Escalated review targets are set by the escalation action, not here
  if (lane === 'escalated_review') {
    return null;
  }

  // Reviewer and approver lanes: no default target (first-available model)
  return null;
}

// ── Initial route ───────────────────────────────────────────────────

/**
 * Create the initial route for a queue item at enqueue time.
 */
export function createInitialRoute(
  routingStore: RoutingStore,
  item: QueueItem,
  actor: string,
): Route {
  const lane = resolveLane(item);
  const target = resolveDefaultTarget(item, lane);
  const now = nowISO();

  const route: Route = {
    routeId: generateId('rt'),
    queueItemId: item.queueItemId,
    lane,
    assignedTarget: target,
    status: 'active',
    reasonCode: 'initial_derivation',
    reason: `Derived from brief: role=${item.role}, priority=${item.priorityClass}`,
    routedBy: actor,
    routedAt: now,
    updatedAt: now,
  };

  routingStore.insertRoute(route);

  routingStore.insertEvent({
    routeId: route.routeId,
    queueItemId: item.queueItemId,
    kind: 'routed',
    toLane: lane,
    toTarget: target ?? undefined,
    reasonCode: 'initial_derivation',
    reason: route.reason,
    actor,
    createdAt: now,
  });

  return route;
}

// ── Reroute ─────────────────────────────────────────────────────────

/**
 * Reroute a queue item to a different lane.
 * Supersedes the current active route.
 */
export function rerouteItem(
  queueStore: QueueStore,
  routingStore: RoutingStore,
  input: {
    queueItemId: string;
    toLane: RoutingLane;
    reasonCode: RoutingReasonCode;
    reason: string;
    actor: string;
    target?: string;
  },
): RouteResult | RoutingError {
  const { queueItemId, toLane, reasonCode, reason, actor, target } = input;

  const item = queueStore.getQueueItem(queueItemId);
  if (!item) {
    return { ok: false, error: `Queue item '${queueItemId}' not found`, code: 'item_not_found' };
  }

  if (TERMINAL_STATUSES.has(item.status)) {
    return { ok: false, error: `Queue item is in terminal state '${item.status}'`, code: 'item_terminal' };
  }

  const currentRoute = routingStore.getActiveRoute(queueItemId);

  // Check same-lane (no-op reroute)
  if (currentRoute && currentRoute.lane === toLane && !target) {
    return { ok: false, error: `Item is already in '${toLane}' lane`, code: 'same_lane' };
  }

  const now = nowISO();
  const fromLane = currentRoute?.lane;
  const fromTarget = currentRoute?.assignedTarget ?? undefined;

  // Supersede current route
  if (currentRoute) {
    routingStore.updateRouteStatus(currentRoute.routeId, 'rerouted');
  }

  // Create new route
  const newRoute: Route = {
    routeId: generateId('rt'),
    queueItemId,
    lane: toLane,
    assignedTarget: target ?? resolveDefaultTarget(item, toLane),
    status: 'active',
    reasonCode,
    reason,
    routedBy: actor,
    routedAt: now,
    updatedAt: now,
  };

  routingStore.insertRoute(newRoute);

  routingStore.insertEvent({
    routeId: newRoute.routeId,
    queueItemId,
    kind: 'rerouted',
    fromLane,
    toLane,
    fromTarget,
    toTarget: newRoute.assignedTarget ?? undefined,
    reasonCode,
    reason,
    actor,
    createdAt: now,
  });

  return { ok: true, route: newRoute };
}

// ── Assign / Unassign ───────────────────────────────────────────────

/**
 * Assign a target to the current active route.
 */
export function assignTarget(
  routingStore: RoutingStore,
  input: {
    queueItemId: string;
    target: string;
    actor: string;
  },
): RouteResult | RoutingError {
  const { queueItemId, target, actor } = input;

  const route = routingStore.getActiveRoute(queueItemId);
  if (!route) {
    return { ok: false, error: `No active route for '${queueItemId}'`, code: 'no_active_route' };
  }

  const now = nowISO();
  const fromTarget = route.assignedTarget ?? undefined;

  routingStore.updateRouteTarget(route.routeId, target);

  routingStore.insertEvent({
    routeId: route.routeId,
    queueItemId,
    kind: 'assigned',
    fromLane: route.lane,
    toLane: route.lane,
    fromTarget,
    toTarget: target,
    reasonCode: 'manual_assign',
    reason: `Assigned to ${target}`,
    actor,
    createdAt: now,
  });

  const updated = routingStore.getRoute(route.routeId)!;
  return { ok: true, route: updated };
}

/**
 * Remove assignment from the current active route.
 */
export function unassignTarget(
  routingStore: RoutingStore,
  input: {
    queueItemId: string;
    actor: string;
    reason: string;
  },
): RouteResult | RoutingError {
  const { queueItemId, actor, reason } = input;

  const route = routingStore.getActiveRoute(queueItemId);
  if (!route) {
    return { ok: false, error: `No active route for '${queueItemId}'`, code: 'no_active_route' };
  }

  const now = nowISO();
  const fromTarget = route.assignedTarget ?? undefined;

  routingStore.updateRouteTarget(route.routeId, null);

  routingStore.insertEvent({
    routeId: route.routeId,
    queueItemId,
    kind: 'unassigned',
    fromLane: route.lane,
    toLane: route.lane,
    fromTarget,
    reasonCode: 'manual_unassign',
    reason,
    actor,
    createdAt: now,
  });

  const updated = routingStore.getRoute(route.routeId)!;
  return { ok: true, route: updated };
}

// ── Automatic reroutes from queue state changes ─────────────────────

/**
 * Apply routing consequences of a queue action.
 * Call this after actOnQueueItem to keep routing in sync.
 */
export function applyActionRouting(
  queueStore: QueueStore,
  routingStore: RoutingStore,
  queueItemId: string,
  action: string,
  actor: string,
): void {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return;

  // Terminal actions → complete the route
  if (TERMINAL_STATUSES.has(item.status)) {
    const route = routingStore.getActiveRoute(queueItemId);
    if (route) {
      routingStore.updateRouteStatus(route.routeId, 'completed');
      routingStore.insertEvent({
        routeId: route.routeId,
        queueItemId,
        kind: 'completed',
        fromLane: route.lane,
        toLane: route.lane,
        reasonCode: action === 'request-recovery' ? 'recovery_requested' : 'initial_derivation',
        reason: `Action '${action}' moved item to terminal state '${item.status}'`,
        actor,
        createdAt: nowISO(),
      });
    }

    // If recovery requested, create a recovery route for awareness
    if (action === 'request-recovery') {
      // The queue item is now terminal (recovery_requested),
      // but a new queue item may be derived. Routing for the new
      // item will be handled at its enqueue time.
    }
    return;
  }

  // Non-terminal action — check if lane should change
  if (action === 'needs-review') {
    // Reroute to reviewer if not already there
    const route = routingStore.getActiveRoute(queueItemId);
    if (route && route.lane !== 'reviewer') {
      rerouteItem(queueStore, routingStore, {
        queueItemId,
        toLane: 'reviewer',
        reasonCode: 'approval_ready',
        reason: 'Action needs-review: routing to reviewer lane',
        actor,
      });
    }
  }
}

/**
 * Apply routing consequences of an escalation.
 */
export function applyEscalationRouting(
  queueStore: QueueStore,
  routingStore: RoutingStore,
  queueItemId: string,
  escalationTarget: string,
  actor: string,
): void {
  rerouteItem(queueStore, routingStore, {
    queueItemId,
    toLane: 'escalated_review',
    reasonCode: 'escalation',
    reason: `Escalated to ${escalationTarget}`,
    actor,
    target: escalationTarget,
  });
}

// ── Staleness/invalidation interruption ─────────────────────────────

/**
 * Interrupt active routes for stale or invalidated items.
 * Returns the number of routes interrupted.
 */
export function interruptStaleRoutes(
  queueStore: QueueStore,
  routingStore: RoutingStore,
): number {
  const activeRoutes = routingStore.listRoutes({ activeOnly: true });
  let count = 0;
  const now = nowISO();

  for (const route of activeRoutes) {
    const item = queueStore.getQueueItem(route.queueItemId);
    if (!item) continue;

    if (item.status === 'stale') {
      routingStore.updateRouteStatus(route.routeId, 'interrupted');
      routingStore.insertEvent({
        routeId: route.routeId,
        queueItemId: route.queueItemId,
        kind: 'interrupted',
        fromLane: route.lane,
        toLane: route.lane,
        reasonCode: 'stale_interrupt',
        reason: 'Item became stale — route interrupted',
        actor: 'system',
        createdAt: now,
      });
      count++;
    } else if (TERMINAL_STATUSES.has(item.status)) {
      routingStore.updateRouteStatus(route.routeId, 'completed');
      routingStore.insertEvent({
        routeId: route.routeId,
        queueItemId: route.queueItemId,
        kind: 'completed',
        fromLane: route.lane,
        toLane: route.lane,
        reasonCode: 'initial_derivation',
        reason: `Item reached terminal state '${item.status}'`,
        actor: 'system',
        createdAt: now,
      });
      count++;
    }
  }

  return count;
}

// ── Aging / resurfacing ─────────────────────────────────────────────

/**
 * Check for deferred items that have resurfaced and restore their routing.
 * Uses supervisor store to find expired deferred claims.
 * Returns the number of items resurfaced.
 */
export function resurfaceDeferredRoutes(
  queueStore: QueueStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
): number {
  const now = nowISO();
  const eligible = supervisorStore.findEligibleDeferred(now);
  let count = 0;

  for (const claim of eligible) {
    const item = queueStore.getQueueItem(claim.queueItemId);
    if (!item || TERMINAL_STATUSES.has(item.status) || item.status === 'stale') continue;

    const route = routingStore.getActiveRoute(claim.queueItemId);
    if (!route) {
      // No active route — create one based on current item state
      const lane = resolveLane(item);
      const restoredRoute: Route = {
        routeId: generateId('rt'),
        queueItemId: item.queueItemId,
        lane,
        assignedTarget: resolveDefaultTarget(item, lane),
        status: 'active',
        reasonCode: 'defer_resurface',
        reason: `Deferred period expired — resurfaced into ${lane} lane`,
        routedBy: 'system',
        routedAt: now,
        updatedAt: now,
      };
      routingStore.insertRoute(restoredRoute);
      routingStore.insertEvent({
        routeId: restoredRoute.routeId,
        queueItemId: item.queueItemId,
        kind: 'routed',
        toLane: lane,
        reasonCode: 'defer_resurface',
        reason: restoredRoute.reason,
        actor: 'system',
        createdAt: now,
      });
      count++;
    }
  }

  return count;
}
