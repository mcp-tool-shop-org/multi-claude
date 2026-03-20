/**
 * Flow Control — Actions.
 *
 * Handles:
 *   - Admission control (can an item enter a lane?)
 *   - Overflow management (what happens when a lane is full?)
 *   - Starvation detection (which items are rotting?)
 *   - Capacity reconciliation (recount from actual state)
 *   - Recovery throttling (prevent retry storms)
 *   - Overflow resurfacing (re-admit items when capacity frees)
 *
 * Law: capacity is explicit, overload is visible, bypass is audited.
 */

import type { QueueStore } from '../queue/queue-store.js';
import { TERMINAL_STATUSES } from '../queue/types.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { RoutingLane } from '../routing/types.js';
import { ALL_LANES } from '../routing/types.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { FlowStore } from './flow-store.js';
import type {
  AdmissionGranted,
  AdmissionDenied,
  LaneCapState,
  FlowStatus,
} from './types.js';
import { DEFAULT_STARVATION_THRESHOLD_MS, DEFAULT_RECOVERY_THROTTLE } from './types.js';
import { nowISO } from '../../lib/ids.js';

// ── Lane capacity computation ───────────────────────────────────────

/**
 * Count active claims in a given lane.
 *
 * An "active" claim is one that:
 *   - has status 'active'
 *   - belongs to a queue item currently routed to the given lane
 */
export function countActiveInLane(
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
): number {
  const activeRoutes = routingStore.listRoutes({ lane, activeOnly: true });
  const now = nowISO();
  let count = 0;

  for (const route of activeRoutes) {
    const claim = supervisorStore.getActiveClaim(route.queueItemId);
    if (claim && claim.leaseExpiresAt > now) {
      count++;
    }
  }

  return count;
}

/**
 * Count pending (unclaimed) items in a given lane.
 */
export function countPendingInLane(
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
): number {
  const activeRoutes = routingStore.listRoutes({ lane, activeOnly: true });
  const now = nowISO();
  let count = 0;

  for (const route of activeRoutes) {
    const claim = supervisorStore.getActiveClaim(route.queueItemId);
    // Pending = no active claim, or lease expired
    if (!claim || claim.leaseExpiresAt <= now) {
      count++;
    }
  }

  return count;
}

/**
 * Compute full lane capacity state.
 */
export function computeLaneState(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
): LaneCapState {
  const wipCap = flowStore.getWipCap(lane);
  const activeCount = countActiveInLane(routingStore, supervisorStore, lane);
  const pendingCount = countPendingInLane(routingStore, supervisorStore, lane);
  const overflowCount = flowStore.countOverflow(lane);
  const starvedCount = 0; // computed separately by detectStarvation

  let flowStatus: FlowStatus = 'open';
  if (activeCount >= wipCap) {
    flowStatus = overflowCount > 0 ? 'overflowing' : 'saturated';
  }

  return {
    lane,
    wipCap,
    activeCount,
    pendingCount,
    overflowCount,
    starvedCount,
    flowStatus,
    updatedAt: nowISO(),
  };
}

/**
 * Compute lane state for all lanes.
 */
export function computeAllLaneStates(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
): LaneCapState[] {
  return ALL_LANES.map(lane =>
    computeLaneState(flowStore, routingStore, supervisorStore, lane),
  );
}

// ── Admission control ───────────────────────────────────────────────

/**
 * Check if an item can be admitted (claimed) in a lane.
 *
 * This is a pre-check — it does not modify state.
 * Returns granted or denied with exact reason.
 */
export function checkAdmission(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
): AdmissionGranted | AdmissionDenied {
  const wipCap = flowStore.getWipCap(lane);
  const activeCount = countActiveInLane(routingStore, supervisorStore, lane);

  if (activeCount >= wipCap) {
    return {
      ok: false,
      lane,
      reason: `Lane '${lane}' is at capacity (${activeCount}/${wipCap})`,
      code: 'lane_full',
      activeCount,
      wipCap,
    };
  }

  return { ok: true, lane };
}

/**
 * Check admission with recovery throttle.
 * Recovery lane has an additional constraint: no more than N consecutive
 * recovery items to prevent retry storms.
 */
export function checkAdmissionWithThrottle(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
  throttle: number = DEFAULT_RECOVERY_THROTTLE,
): AdmissionGranted | AdmissionDenied {
  // Base admission check first
  const base = checkAdmission(flowStore, routingStore, supervisorStore, lane);
  if (!base.ok) return base;

  // Recovery throttle only applies to recovery lane
  if (lane === 'recovery') {
    const activeCount = countActiveInLane(routingStore, supervisorStore, lane);
    if (activeCount >= throttle) {
      return {
        ok: false,
        lane,
        reason: `Recovery lane throttled (${activeCount} active, throttle=${throttle})`,
        code: 'recovery_throttled',
        activeCount,
        wipCap: flowStore.getWipCap(lane),
      };
    }
  }

  return base;
}

// ── Overflow management ─────────────────────────────────────────────

/**
 * Record an item as overflowed when admission is denied.
 */
export function enterOverflow(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  lane: RoutingLane,
  reason: string,
  actor: string,
): void {
  const activeCount = countActiveInLane(routingStore, supervisorStore, lane);
  const wipCap = flowStore.getWipCap(lane);
  const now = nowISO();

  flowStore.addOverflow(queueItemId, lane, 'lane_full', reason);

  flowStore.insertEvent({
    lane,
    kind: 'overflow_entered',
    priorActiveCount: activeCount,
    newActiveCount: activeCount,
    wipCap,
    reasonCode: 'lane_full',
    reason,
    actor,
    queueItemId,
    createdAt: now,
  });
}

/**
 * Resurface overflowed items when capacity becomes available.
 * Returns the number of items resurfaced.
 */
export function resurfaceOverflow(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
): number {
  let total = 0;

  for (const lane of ALL_LANES) {
    const wipCap = flowStore.getWipCap(lane);
    const activeCount = countActiveInLane(routingStore, supervisorStore, lane);
    const available = wipCap - activeCount;

    if (available <= 0) continue;

    const overflowed = flowStore.listOverflow(lane);
    const toResurface = overflowed.slice(0, available);

    for (const item of toResurface) {
      // Verify the queue item still exists and is actionable
      const queueItem = queueStore.getQueueItem(item.queueItemId);
      if (!queueItem || TERMINAL_STATUSES.has(queueItem.status) || queueItem.status === 'stale') {
        // Clean up stale overflow entries
        flowStore.removeOverflow(item.queueItemId);
        continue;
      }

      flowStore.removeOverflow(item.queueItemId);

      const newActive = countActiveInLane(routingStore, supervisorStore, lane);
      flowStore.insertEvent({
        lane,
        kind: 'overflow_exited',
        priorActiveCount: activeCount,
        newActiveCount: newActive,
        wipCap,
        reasonCode: 'overflow_resurface',
        reason: `Capacity available — resurfaced from overflow`,
        actor: 'system',
        queueItemId: item.queueItemId,
        createdAt: nowISO(),
      });

      total++;
    }
  }

  return total;
}

// ── Capacity events ─────────────────────────────────────────────────

/**
 * Record a capacity-freed event (after claim release or expiry).
 */
export function recordCapacityFreed(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
  queueItemId: string,
  reasonCode: 'claim_released' | 'claim_expired',
  actor: string,
): void {
  const wipCap = flowStore.getWipCap(lane);
  const activeCount = countActiveInLane(routingStore, supervisorStore, lane);

  flowStore.insertEvent({
    lane,
    kind: 'capacity_freed',
    priorActiveCount: activeCount + 1, // was one higher before release
    newActiveCount: activeCount,
    wipCap,
    reasonCode,
    reason: `Capacity freed in '${lane}' lane`,
    actor,
    queueItemId,
    createdAt: nowISO(),
  });
}

/**
 * Record a WIP cap change event.
 */
export function recordCapChange(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  lane: RoutingLane,
  oldCap: number,
  newCap: number,
  actor: string,
  reason: string,
): void {
  const activeCount = countActiveInLane(routingStore, supervisorStore, lane);

  flowStore.insertEvent({
    lane,
    kind: 'cap_set',
    priorActiveCount: activeCount,
    newActiveCount: activeCount,
    wipCap: newCap,
    reasonCode: 'cap_change',
    reason: `WIP cap changed: ${oldCap} → ${newCap}. ${reason}`,
    actor,
    createdAt: nowISO(),
  });
}

// ── Starvation detection ────────────────────────────────────────────

export interface StarvedItem {
  queueItemId: string;
  lane: RoutingLane;
  ageMs: number;
  createdAt: string;
}

/**
 * Detect items that have been waiting beyond the starvation threshold.
 *
 * A starved item is:
 *   - actively routed (not terminal, not stale)
 *   - not currently claimed (or claim expired)
 *   - older than the starvation threshold
 */
export function detectStarvation(
  queueStore: QueueStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  thresholdMs: number = DEFAULT_STARVATION_THRESHOLD_MS,
): StarvedItem[] {
  const now = new Date().getTime();
  const activeRoutes = routingStore.listRoutes({ activeOnly: true });
  const starved: StarvedItem[] = [];
  const currentTime = nowISO();

  for (const route of activeRoutes) {
    const item = queueStore.getQueueItem(route.queueItemId);
    if (!item || TERMINAL_STATUSES.has(item.status) || item.status === 'stale') continue;

    // Check if unclaimed or claim expired
    const claim = supervisorStore.getActiveClaim(route.queueItemId);
    if (claim && claim.leaseExpiresAt > currentTime) continue; // actively being worked

    const itemAge = now - new Date(item.createdAt).getTime();
    if (itemAge >= thresholdMs) {
      starved.push({
        queueItemId: route.queueItemId,
        lane: route.lane,
        ageMs: itemAge,
        createdAt: item.createdAt,
      });
    }
  }

  // Sort oldest first
  starved.sort((a, b) => b.ageMs - a.ageMs);
  return starved;
}

/**
 * Record starvation detection events.
 * Returns number of newly starved items detected.
 */
export function recordStarvation(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  starvedItems: StarvedItem[],
): number {
  let count = 0;

  for (const item of starvedItems) {
    const wipCap = flowStore.getWipCap(item.lane);
    const activeCount = countActiveInLane(routingStore, supervisorStore, item.lane);

    flowStore.insertEvent({
      lane: item.lane,
      kind: 'starvation_detected',
      priorActiveCount: activeCount,
      newActiveCount: activeCount,
      wipCap,
      reasonCode: 'starvation_threshold',
      reason: `Item starved: age=${Math.round(item.ageMs / 1000)}s`,
      actor: 'system',
      queueItemId: item.queueItemId,
      createdAt: nowISO(),
    });
    count++;
  }

  return count;
}

// ── Cap management ──────────────────────────────────────────────────

export interface SetCapResult {
  ok: true;
  lane: RoutingLane;
  oldCap: number;
  newCap: number;
}

export interface SetCapError {
  ok: false;
  error: string;
  code: 'invalid_cap' | 'same_cap';
}

/**
 * Set the WIP cap for a lane.
 */
export function setLaneCap(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  input: {
    lane: RoutingLane;
    cap: number;
    actor: string;
    reason: string;
  },
): SetCapResult | SetCapError {
  const { lane, cap, actor, reason } = input;

  if (cap < 1) {
    return { ok: false, error: 'WIP cap must be at least 1', code: 'invalid_cap' };
  }

  const oldCap = flowStore.getWipCap(lane);
  if (oldCap === cap) {
    return { ok: false, error: `Lane '${lane}' already has cap ${cap}`, code: 'same_cap' };
  }

  flowStore.setWipCap(lane, cap, actor, reason);
  recordCapChange(flowStore, routingStore, supervisorStore, lane, oldCap, cap, actor, reason);

  return { ok: true, lane, oldCap, newCap: cap };
}

// ── Reconciliation ──────────────────────────────────────────────────

/**
 * Reconcile lane counts from actual state.
 * Use when counts may have drifted from reality.
 * Returns lane states after reconciliation.
 */
export function reconcileLaneCounts(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
): LaneCapState[] {
  const states = computeAllLaneStates(flowStore, routingStore, supervisorStore);
  const now = nowISO();

  for (const state of states) {
    flowStore.insertEvent({
      lane: state.lane,
      kind: 'capacity_recalc',
      priorActiveCount: state.activeCount,
      newActiveCount: state.activeCount,
      wipCap: state.wipCap,
      reasonCode: 'reconciliation',
      reason: `Reconciled: active=${state.activeCount}, pending=${state.pendingCount}, overflow=${state.overflowCount}`,
      actor: 'system',
      createdAt: now,
    });
  }

  return states;
}
