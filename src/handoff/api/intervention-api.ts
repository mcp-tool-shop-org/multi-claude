/**
 * Intervention Law — API layer.
 *
 * Provides intervention-aware inspect and health summary.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { RoutingLane } from '../routing/types.js';
import type { FlowStore } from '../flow/flow-store.js';
import type { InterventionStore } from '../intervention/intervention-store.js';
import type {
  HealthSnapshot,
  Intervention,
  InterventionEvent,
  BreachThresholds,
} from '../intervention/types.js';
import {
  deriveHealthSnapshot,
  deriveAllHealthSnapshots,
} from '../intervention/intervention-actions.js';

// ── Health inspect ──────────────────────────────────────────────────

export interface HealthInspectResult {
  ok: true;
  snapshots: HealthSnapshot[];
  activeInterventions: Intervention[];
  recentEvents: InterventionEvent[];
}

/**
 * Full health inspection across all lanes.
 */
export function healthInspect(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  opts?: { thresholds?: BreachThresholds },
): HealthInspectResult {
  const snapshots = deriveAllHealthSnapshots(
    flowStore, routingStore, supervisorStore, queueStore, interventionStore,
    opts?.thresholds,
  );
  const activeInterventions = interventionStore.listInterventions({ activeOnly: true });
  const recentEvents = interventionStore.getEvents({ limit: 50 });

  return { ok: true, snapshots, activeInterventions, recentEvents };
}

// ── Lane health inspect ─────────────────────────────────────────────

export interface LaneHealthResult {
  ok: true;
  snapshot: HealthSnapshot;
  intervention: Intervention | null;
  events: InterventionEvent[];
}

/**
 * Inspect a single lane's health and intervention state.
 */
export function laneHealthInspect(
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  lane: RoutingLane,
  opts?: { thresholds?: BreachThresholds },
): LaneHealthResult {
  const snapshot = deriveHealthSnapshot(
    flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane,
    opts?.thresholds,
  );
  const intervention = interventionStore.getActiveIntervention(lane);
  const events = interventionStore.getEvents({ lane, limit: 20 });

  return { ok: true, snapshot, intervention: intervention ?? null, events };
}
