/**
 * Flow Control — Types.
 *
 * Deterministic capacity, starvation, and overflow state
 * for the routing law's lane system.
 *
 * Law: work distribution respects durable capacity limits.
 * Overload is explicit. Starvation is detectable. Bypass is audited.
 */

import type { RoutingLane } from '../routing/types.js';

// ── Lane capacity state ─────────────────────────────────────────────

export interface LaneCapState {
  lane: RoutingLane;
  wipCap: number;            // max concurrent active claims in this lane
  activeCount: number;        // current active claims (computed, cached)
  pendingCount: number;       // items routed to lane but unclaimed
  overflowCount: number;      // items denied admission due to cap
  starvedCount: number;       // items exceeding starvation threshold
  flowStatus: FlowStatus;
  updatedAt: string;
}

export type FlowStatus =
  | 'open'           // lane has capacity
  | 'saturated'      // lane is at cap
  | 'overflowing';   // lane is at cap AND items were denied admission

// ── Flow events ─────────────────────────────────────────────────────

export interface FlowEvent {
  lane: RoutingLane;
  kind: FlowEventKind;
  priorActiveCount: number;
  newActiveCount: number;
  wipCap: number;
  reasonCode: FlowReasonCode;
  reason: string;
  actor: string;
  queueItemId?: string;       // item that triggered the event, if any
  createdAt: string;
}

export type FlowEventKind =
  | 'cap_set'              // WIP cap changed
  | 'admission_denied'     // item denied entry to lane
  | 'admission_granted'    // item admitted to lane
  | 'overflow_entered'     // item moved to overflow
  | 'overflow_exited'      // item left overflow (capacity freed)
  | 'starvation_detected'  // item crossed starvation threshold
  | 'starvation_cleared'   // starved item was handled
  | 'capacity_freed'       // claim released/expired, capacity opened
  | 'capacity_recalc';     // counts reconciled from actual state

export type FlowReasonCode =
  | 'cap_change'           // operator changed the cap
  | 'lane_full'            // lane at capacity
  | 'capacity_available'   // lane has room
  | 'claim_released'       // claim released, freeing capacity
  | 'claim_expired'        // lease expired, freeing capacity
  | 'starvation_threshold' // item exceeded age threshold
  | 'starvation_resolved'  // starved item was acted on
  | 'reconciliation'       // counts recomputed from actual state
  | 'overflow_resurface'   // overflow item re-admitted
  | 'recovery_throttle';   // recovery lane throttled

// ── Admission result ────────────────────────────────────────────────

export interface AdmissionGranted {
  ok: true;
  lane: RoutingLane;
}

export interface AdmissionDenied {
  ok: false;
  lane: RoutingLane;
  reason: string;
  code: 'lane_full' | 'recovery_throttled';
  activeCount: number;
  wipCap: number;
}

// ── Starvation config ───────────────────────────────────────────────

/**
 * Default starvation threshold in milliseconds.
 * Items older than this with no action are considered starved.
 * 4 hours by default.
 */
export const DEFAULT_STARVATION_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/**
 * Default WIP cap per lane.
 */
export const DEFAULT_WIP_CAP = 5;

/**
 * Maximum consecutive recovery items allowed before throttling.
 */
export const DEFAULT_RECOVERY_THROTTLE = 3;
