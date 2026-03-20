/**
 * Routing Law — Phase 6 canonical types.
 *
 * Routing turns supervisor motion into deterministic work distribution.
 * Every active queue item has one canonical lane, one optional owner,
 * and a durable audit trail of how it got there.
 *
 * Lanes are structural, not semantic:
 *   reviewer → approver → (done)
 *   reviewer → recovery → reviewer (retry)
 *   reviewer → escalated_review → approver (complex path)
 */

// ── Canonical lanes ─────────────────────────────────────────────────

export type RoutingLane =
  | 'reviewer'          // needs reviewer attention
  | 'approver'          // needs approver signoff
  | 'recovery'          // needs worker recovery
  | 'escalated_review'; // needs higher-level review

export const ALL_LANES: readonly RoutingLane[] = [
  'reviewer', 'approver', 'recovery', 'escalated_review',
];

// ── Route state ─────────────────────────────────────────────────────

export type RouteStatus =
  | 'active'     // currently routed and actionable
  | 'rerouted'   // superseded by a newer route
  | 'completed'  // item reached terminal state from this route
  | 'interrupted'; // staleness/invalidation interrupted this route

export interface Route {
  routeId: string;
  queueItemId: string;
  lane: RoutingLane;
  assignedTarget: string | null;
  status: RouteStatus;
  reasonCode: RoutingReasonCode;
  reason: string;
  routedBy: string;
  routedAt: string;
  updatedAt: string;
}

// ── Reason codes ────────────────────────────────────────────────────

export type RoutingReasonCode =
  | 'initial_derivation'     // derived from brief at enqueue time
  | 'approval_ready'         // no blockers, ready for approver
  | 'recovery_requested'     // action requested recovery
  | 'escalation'             // supervisor escalated
  | 'manual_reroute'         // operator explicitly rerouted
  | 'manual_assign'          // operator explicitly assigned
  | 'manual_unassign'        // operator explicitly unassigned
  | 'stale_interrupt'        // staleness interrupted route
  | 'invalidation_interrupt' // invalidation interrupted route
  | 'requeue_restore'        // requeue restored to original lane
  | 'defer_resurface'        // deferred item resurfaced
  | 'aging_escalation';      // aging policy escalated

// ── Routing events ──────────────────────────────────────────────────

export type RoutingEventKind =
  | 'routed'
  | 'rerouted'
  | 'assigned'
  | 'unassigned'
  | 'interrupted'
  | 'completed';

export interface RoutingEvent {
  eventId?: number;
  routeId: string;
  queueItemId: string;
  kind: RoutingEventKind;
  fromLane?: RoutingLane;
  toLane: RoutingLane;
  fromTarget?: string;
  toTarget?: string;
  reasonCode: RoutingReasonCode;
  reason: string;
  actor: string;
  createdAt: string;
}
