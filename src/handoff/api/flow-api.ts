/**
 * Flow Control — API layer.
 *
 * Provides flow-aware inspect and re-exports core flow actions.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { RoutingLane } from '../routing/types.js';
import type { FlowStore, OverflowRow } from '../flow/flow-store.js';
import type { LaneCapState, AdmissionGranted, AdmissionDenied, FlowEvent } from '../flow/types.js';
import {
  computeLaneState,
  computeAllLaneStates,
  checkAdmission,
  detectStarvation,
  type StarvedItem,
} from '../flow/flow-actions.js';

// ── Flow inspect ────────────────────────────────────────────────────

export interface FlowInspectResult {
  ok: true;
  lanes: LaneCapState[];
  overflow: OverflowRow[];
  starved: StarvedItem[];
  recentEvents: FlowEvent[];
}

/**
 * Full flow state inspection across all lanes.
 */
export function flowInspect(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  opts?: { starvationThresholdMs?: number },
): FlowInspectResult {
  const lanes = computeAllLaneStates(flowStore, routingStore, supervisorStore);
  const overflow = flowStore.listOverflow();
  const starved = detectStarvation(
    queueStore, routingStore, supervisorStore,
    opts?.starvationThresholdMs,
  );
  const recentEvents = flowStore.getEvents({ limit: 50 });

  return { ok: true, lanes, overflow, starved, recentEvents };
}

// ── Lane-specific inspect ───────────────────────────────────────────

export interface LaneInspectResult {
  ok: true;
  state: LaneCapState;
  admission: AdmissionGranted | AdmissionDenied;
  overflow: OverflowRow[];
  starved: StarvedItem[];
  recentEvents: FlowEvent[];
}

/**
 * Inspect a single lane's flow state.
 */
export function laneInspect(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  lane: RoutingLane,
  opts?: { starvationThresholdMs?: number },
): LaneInspectResult {
  const state = computeLaneState(flowStore, routingStore, supervisorStore, lane);
  const admission = checkAdmission(flowStore, routingStore, supervisorStore, lane);
  const overflow = flowStore.listOverflow(lane);
  const allStarved = detectStarvation(
    queueStore, routingStore, supervisorStore,
    opts?.starvationThresholdMs,
  );
  const starved = allStarved.filter(s => s.lane === lane);
  const recentEvents = flowStore.getEvents({ lane, limit: 20 });

  return { ok: true, state, admission, overflow, starved, recentEvents };
}
