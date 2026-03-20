/**
 * Routing Law — API layer.
 *
 * Re-exports core actions and provides routing-aware inspect.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { QueueItem } from '../queue/types.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { Route, RoutingEvent, RoutingLane } from '../routing/types.js';
import type { SupervisorClaim } from '../supervisor/types.js';
import type { DecisionBrief } from '../decision/types.js';
import { renderReviewerBrief } from '../decision/reviewer-decision-renderer.js';
import { renderApproverBrief } from '../decision/approver-decision-renderer.js';

// ── Routed inspect ──────────────────────────────────────────────────

export interface RoutedInspectResult {
  ok: true;
  item: QueueItem;
  brief: DecisionBrief;
  renderedText: string;
  queueEvents: ReturnType<QueueStore['getEvents']>;
  /** Current routing state */
  route: Route | null;
  routeHistory: Route[];
  routingEvents: RoutingEvent[];
  /** Supervisor claim state */
  claim: SupervisorClaim | null;
  /** Composite view */
  currentLane: RoutingLane | null;
  assignedTarget: string | null;
  canReroute: boolean;
}

export interface RoutedInspectError {
  ok: false;
  error: string;
}

/**
 * Full inspect with routing + supervisor + queue state.
 */
export function routedInspect(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  routingStore: RoutingStore,
  queueItemId: string,
): RoutedInspectResult | RoutedInspectError {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return { ok: false, error: `Queue item '${queueItemId}' not found` };

  const brief = queueStore.getBrief(item.briefId);
  if (!brief) return { ok: false, error: `Brief '${item.briefId}' not found` };

  const renderedText = brief.role === 'reviewer'
    ? renderReviewerBrief(brief)
    : renderApproverBrief(brief);

  const queueEvents = queueStore.getEvents(queueItemId);
  const route = routingStore.getActiveRoute(queueItemId);
  const routeHistory = routingStore.getRouteHistory(queueItemId);
  const routingEvents = routingStore.getEvents(queueItemId);
  const claim = supervisorStore.getActiveOrDeferredClaim(queueItemId);

  const isTerminal = ['approved', 'rejected', 'recovery_requested', 'cleared'].includes(item.status);
  const canReroute = !isTerminal && item.status !== 'stale';

  return {
    ok: true,
    item,
    brief,
    renderedText,
    queueEvents,
    route,
    routeHistory,
    routingEvents,
    claim,
    currentLane: route?.lane ?? null,
    assignedTarget: route?.assignedTarget ?? null,
    canReroute,
  };
}

// ── Re-exports ──────────────────────────────────────────────────────

export {
  resolveLane,
  resolveDefaultTarget,
  createInitialRoute,
  rerouteItem,
  assignTarget,
  unassignTarget,
  applyActionRouting,
  applyEscalationRouting,
  interruptStaleRoutes,
  resurfaceDeferredRoutes,
  type RouteResult,
  type RoutingError,
} from '../routing/routing-actions.js';
